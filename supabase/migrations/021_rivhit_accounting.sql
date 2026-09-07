-- ============================================================
-- Migration 021: External accounting state (Rivhit first)
--
-- Expand-only migration. Existing orders, sales and local RCP-* receipts are
-- unchanged. In particular, sales.receipt_number is not a Rivhit document ID.
--
-- Rollback, if this migration has not been used in Production:
--   DROP FUNCTION public.claim_accounting_document(text, uuid, text, text, text, integer, text, text, integer);
--   DROP FUNCTION public.claim_accounting_customer(text, text, text, integer);
--   DROP TABLE public.accounting_documents;
--   DROP TABLE public.accounting_customers;
-- ============================================================

CREATE TABLE public.accounting_customers (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider              TEXT NOT NULL CHECK (provider <> ''),
  identity_key          TEXT NOT NULL CHECK (identity_key <> ''),
  external_customer_id  TEXT,
  external_reference    TEXT NOT NULL CHECK (external_reference <> ''),
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'processing',
      'succeeded',
      'retryable_error',
      'permanent_error',
      'reconciliation_required'
    )
  ),
  attempt_count         INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at       TIMESTAMPTZ,
  retry_after           TIMESTAMPTZ,
  last_error            JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, identity_key),
  UNIQUE (provider, external_reference)
);

CREATE UNIQUE INDEX idx_accounting_customers_external_id
  ON public.accounting_customers(provider, external_customer_id)
  WHERE external_customer_id IS NOT NULL;

CREATE INDEX idx_accounting_customers_retry
  ON public.accounting_customers(status, retry_after)
  WHERE status IN ('processing', 'retryable_error');

CREATE TRIGGER trg_accounting_customers_updated_at
  BEFORE UPDATE ON public.accounting_customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE public.accounting_documents (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider                  TEXT NOT NULL CHECK (provider <> ''),
  accounting_customer_id    UUID NOT NULL REFERENCES public.accounting_customers(id) ON DELETE RESTRICT,
  source_type               TEXT NOT NULL CHECK (source_type <> ''),
  source_id                 TEXT NOT NULL CHECK (source_id <> ''),
  document_type_key         TEXT NOT NULL CHECK (document_type_key <> ''),
  external_document_type    INTEGER NOT NULL CHECK (external_document_type BETWEEN 1 AND 999),
  status                    TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'processing',
      'succeeded',
      'retryable_error',
      'permanent_error',
      'reconciliation_required'
    )
  ),
  request_reference         TEXT NOT NULL CHECK (request_reference <> ''),
  payload_hash              TEXT NOT NULL CHECK (payload_hash <> ''),
  external_document_id      TEXT,
  external_document_number  TEXT,
  document_url              TEXT,
  attempt_count             INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at           TIMESTAMPTZ,
  retry_after               TIMESTAMPTZ,
  last_error                JSONB,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, source_type, source_id, document_type_key),
  UNIQUE (provider, request_reference)
);

CREATE INDEX idx_accounting_documents_customer_id
  ON public.accounting_documents(accounting_customer_id);

CREATE UNIQUE INDEX idx_accounting_documents_external_id
  ON public.accounting_documents(provider, external_document_id)
  WHERE external_document_id IS NOT NULL;

CREATE INDEX idx_accounting_documents_retry
  ON public.accounting_documents(status, retry_after)
  WHERE status IN ('processing', 'retryable_error');

CREATE TRIGGER trg_accounting_documents_updated_at
  BEFORE UPDATE ON public.accounting_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.accounting_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounting customers: admin/ops read"
  ON public.accounting_customers FOR SELECT
  USING (public.is_admin_or_ops());

CREATE POLICY "accounting documents: admin/ops read"
  ON public.accounting_documents FOR SELECT
  USING (public.is_admin_or_ops());

-- Claim customer work without holding a transaction open during HTTP calls.
CREATE OR REPLACE FUNCTION public.claim_accounting_customer(
  p_provider TEXT,
  p_identity_key TEXT,
  p_external_reference TEXT,
  p_stale_after_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  id UUID,
  status TEXT,
  external_customer_id TEXT,
  claimed BOOLEAN,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted_id UUID;
  v_row public.accounting_customers%ROWTYPE;
BEGIN
  INSERT INTO public.accounting_customers (
    provider,
    identity_key,
    external_reference,
    status,
    attempt_count,
    last_attempt_at
  )
  VALUES (
    p_provider,
    p_identity_key,
    p_external_reference,
    'processing',
    1,
    NOW()
  )
  ON CONFLICT (provider, identity_key) DO NOTHING
  RETURNING accounting_customers.id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.accounting_customers ac
    WHERE ac.id = v_inserted_id;

    RETURN QUERY SELECT v_row.id, v_row.status, v_row.external_customer_id, TRUE, v_row.attempt_count;
    RETURN;
  END IF;

  SELECT * INTO v_row
  FROM public.accounting_customers ac
  WHERE ac.provider = p_provider
    AND ac.identity_key = p_identity_key
  FOR UPDATE;

  IF v_row.external_reference <> p_external_reference THEN
    RAISE EXCEPTION 'accounting customer idempotency mismatch';
  END IF;

  IF v_row.status = 'succeeded'
     OR v_row.status IN ('permanent_error', 'reconciliation_required')
     OR (
       v_row.status = 'processing'
       AND v_row.updated_at > NOW() - make_interval(secs => GREATEST(p_stale_after_seconds, 1))
     )
     OR (
       v_row.status = 'retryable_error'
       AND v_row.retry_after IS NOT NULL
       AND v_row.retry_after > NOW()
     ) THEN
    RETURN QUERY SELECT v_row.id, v_row.status, v_row.external_customer_id, FALSE, v_row.attempt_count;
    RETURN;
  END IF;

  UPDATE public.accounting_customers ac
  SET status = 'processing',
      attempt_count = ac.attempt_count + 1,
      last_attempt_at = NOW(),
      retry_after = NULL,
      last_error = NULL
  WHERE ac.id = v_row.id
  RETURNING ac.* INTO v_row;

  RETURN QUERY SELECT v_row.id, v_row.status, v_row.external_customer_id, TRUE, v_row.attempt_count;
END;
$$;

-- Claim document work and reject reuse after the accounting payload changed.
CREATE OR REPLACE FUNCTION public.claim_accounting_document(
  p_provider TEXT,
  p_accounting_customer_id UUID,
  p_source_type TEXT,
  p_source_id TEXT,
  p_document_type_key TEXT,
  p_external_document_type INTEGER,
  p_request_reference TEXT,
  p_payload_hash TEXT,
  p_stale_after_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  id UUID,
  status TEXT,
  external_document_id TEXT,
  external_document_number TEXT,
  document_url TEXT,
  claimed BOOLEAN,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted_id UUID;
  v_row public.accounting_documents%ROWTYPE;
BEGIN
  INSERT INTO public.accounting_documents (
    provider,
    accounting_customer_id,
    source_type,
    source_id,
    document_type_key,
    external_document_type,
    status,
    request_reference,
    payload_hash,
    attempt_count,
    last_attempt_at
  )
  VALUES (
    p_provider,
    p_accounting_customer_id,
    p_source_type,
    p_source_id,
    p_document_type_key,
    p_external_document_type,
    'processing',
    p_request_reference,
    p_payload_hash,
    1,
    NOW()
  )
  ON CONFLICT (provider, source_type, source_id, document_type_key) DO NOTHING
  RETURNING accounting_documents.id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.accounting_documents ad
    WHERE ad.id = v_inserted_id;

    RETURN QUERY SELECT
      v_row.id,
      v_row.status,
      v_row.external_document_id,
      v_row.external_document_number,
      v_row.document_url,
      TRUE,
      v_row.attempt_count;
    RETURN;
  END IF;

  SELECT * INTO v_row
  FROM public.accounting_documents ad
  WHERE ad.provider = p_provider
    AND ad.source_type = p_source_type
    AND ad.source_id = p_source_id
    AND ad.document_type_key = p_document_type_key
  FOR UPDATE;

  IF v_row.accounting_customer_id <> p_accounting_customer_id
     OR v_row.external_document_type <> p_external_document_type
     OR v_row.request_reference <> p_request_reference
     OR v_row.payload_hash <> p_payload_hash THEN
    RAISE EXCEPTION 'accounting document idempotency mismatch';
  END IF;

  IF v_row.status = 'succeeded'
     OR v_row.status IN ('permanent_error', 'reconciliation_required')
     OR (
       v_row.status = 'processing'
       AND v_row.updated_at > NOW() - make_interval(secs => GREATEST(p_stale_after_seconds, 1))
     )
     OR (
       v_row.status = 'retryable_error'
       AND v_row.retry_after IS NOT NULL
       AND v_row.retry_after > NOW()
     ) THEN
    RETURN QUERY SELECT
      v_row.id,
      v_row.status,
      v_row.external_document_id,
      v_row.external_document_number,
      v_row.document_url,
      FALSE,
      v_row.attempt_count;
    RETURN;
  END IF;

  UPDATE public.accounting_documents ad
  SET status = 'processing',
      attempt_count = ad.attempt_count + 1,
      last_attempt_at = NOW(),
      retry_after = NULL,
      last_error = NULL
  WHERE ad.id = v_row.id
  RETURNING ad.* INTO v_row;

  RETURN QUERY SELECT
    v_row.id,
    v_row.status,
    v_row.external_document_id,
    v_row.external_document_number,
    v_row.document_url,
    TRUE,
    v_row.attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_accounting_customer(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_accounting_customer(TEXT, TEXT, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_accounting_customer(TEXT, TEXT, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_accounting_customer(TEXT, TEXT, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_accounting_document(TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_accounting_document(TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_accounting_document(TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_accounting_document(TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, INTEGER) TO service_role;

COMMENT ON TABLE public.accounting_customers IS
  'Provider-neutral external accounting customer identities. Rivhit is the first provider.';

COMMENT ON TABLE public.accounting_documents IS
  'Provider-neutral external accounting document state. Local sales RCP-* receipts are not rows unless explicitly exported in a future integration.';
