-- Additive server-side workflow for hosted Pelecard payments.
-- Provider calls happen before these short, service-role-only transactions.

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS provider_redirect_url TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_transactions_provider_redirect_url_safe'
      AND conrelid = 'public.payment_transactions'::regclass
  ) THEN
    ALTER TABLE public.payment_transactions
      ADD CONSTRAINT payment_transactions_provider_redirect_url_safe CHECK (
        provider_redirect_url IS NULL OR (
          provider_redirect_url = btrim(provider_redirect_url)
          AND length(provider_redirect_url) BETWEEN 9 AND 2048
          AND provider_redirect_url ~ '^https://[^[:space:]]+$'
        )
      ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.payment_transactions
  VALIDATE CONSTRAINT payment_transactions_provider_redirect_url_safe;

CREATE OR REPLACE FUNCTION public.protect_payment_redirect_url()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.provider_redirect_url IS NOT NULL
     AND NEW.provider_redirect_url IS DISTINCT FROM OLD.provider_redirect_url THEN
    RAISE EXCEPTION 'provider redirect url is immutable once assigned'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_payment_redirect_url()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER trg_payment_transactions_redirect_immutable
  BEFORE UPDATE OF provider_redirect_url ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.protect_payment_redirect_url();

-- The redirect URL and provider session are returned only by authenticated
-- Edge Functions. Preserve staff reads of the original ledger columns.
REVOKE SELECT ON public.payment_transactions FROM authenticated;
GRANT SELECT (
  id,
  provider,
  operation,
  parent_transaction_id,
  order_id,
  sale_id,
  provider_transaction_id,
  approval_id,
  amount,
  currency,
  status,
  provider_status_code,
  failure_code,
  failure_message,
  checkout_snapshot,
  created_by,
  verified_at,
  created_at,
  updated_at
) ON public.payment_transactions TO authenticated;

CREATE OR REPLACE FUNCTION public.reserve_pelecard_payment(
  p_payment_id UUID,
  p_order_id UUID,
  p_created_by UUID,
  p_idempotency_key TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_checkout_snapshot JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  payment_row public.payment_transactions%ROWTYPE;
  was_created BOOLEAN;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.payment_transactions (
    id,
    provider,
    operation,
    order_id,
    amount,
    currency,
    status,
    idempotency_key,
    checkout_snapshot,
    created_by
  ) VALUES (
    p_payment_id,
    'pelecard',
    'payment',
    p_order_id,
    p_amount,
    p_currency,
    'initiated',
    p_idempotency_key,
    p_checkout_snapshot,
    p_created_by
  )
  ON CONFLICT (provider, idempotency_key) DO NOTHING
  RETURNING * INTO payment_row;

  was_created := FOUND;
  IF NOT was_created THEN
    SELECT *
    INTO STRICT payment_row
    FROM public.payment_transactions
    WHERE provider = 'pelecard'
      AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN to_jsonb(payment_row) || jsonb_build_object('created', was_created);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_pelecard_initiation(
  p_payment_id UUID,
  p_provider_session_id TEXT,
  p_provider_redirect_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  payment_row public.payment_transactions%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT payment_row
  FROM public.payment_transactions
  WHERE id = p_payment_id AND provider = 'pelecard' AND operation = 'payment'
  FOR UPDATE;

  IF payment_row.provider_session_id IS NOT NULL THEN
    IF payment_row.provider_session_id IS DISTINCT FROM p_provider_session_id
       OR payment_row.provider_redirect_url IS DISTINCT FROM p_provider_redirect_url THEN
      RAISE EXCEPTION 'provider session mismatch' USING ERRCODE = '23514';
    END IF;
    RETURN to_jsonb(payment_row);
  END IF;

  IF payment_row.status <> 'initiated' THEN
    RAISE EXCEPTION 'payment cannot accept a provider session'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.payment_transactions
  SET provider_session_id = p_provider_session_id,
      provider_redirect_url = p_provider_redirect_url,
      status = 'pending_provider',
      failure_code = NULL,
      failure_message = NULL
  WHERE id = p_payment_id
  RETURNING * INTO payment_row;

  RETURN to_jsonb(payment_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_pelecard_initiation_uncertain(
  p_payment_id UUID,
  p_failure_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  payment_row public.payment_transactions%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT payment_row
  FROM public.payment_transactions
  WHERE id = p_payment_id AND provider = 'pelecard' AND operation = 'payment'
  FOR UPDATE;

  IF payment_row.status = 'initiated' THEN
    UPDATE public.payment_transactions
    SET status = 'timed_out',
        failure_code = left(btrim(p_failure_code), 100),
        failure_message = NULL
    WHERE id = p_payment_id
    RETURNING * INTO payment_row;
  END IF;

  RETURN to_jsonb(payment_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pelecard_payment(p_payment_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT to_jsonb(p) || jsonb_build_object('receipt_number', s.receipt_number)
  FROM public.payment_transactions AS p
  LEFT JOIN public.sales AS s ON s.id = p.sale_id
  WHERE p.id = p_payment_id AND p.provider = 'pelecard'
$$;

CREATE OR REPLACE FUNCTION public.fail_pelecard_payment(
  p_payment_id UUID,
  p_provider_status_code TEXT,
  p_failure_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  payment_row public.payment_transactions%ROWTYPE;
  receipt TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT payment_row
  FROM public.payment_transactions
  WHERE id = p_payment_id AND provider = 'pelecard' AND operation = 'payment'
  FOR UPDATE;

  IF payment_row.status IN (
    'succeeded', 'failed', 'refund_pending', 'refunded', 'void_pending', 'voided'
  ) THEN
    SELECT receipt_number INTO receipt FROM public.sales WHERE id = payment_row.sale_id;
    RETURN to_jsonb(payment_row) || jsonb_build_object('receipt_number', receipt);
  END IF;

  UPDATE public.payment_transactions
  SET status = 'failed',
      provider_status_code = left(btrim(p_provider_status_code), 100),
      failure_code = left(btrim(p_failure_code), 100),
      failure_message = NULL
  WHERE id = p_payment_id
  RETURNING * INTO payment_row;

  RETURN to_jsonb(payment_row) || jsonb_build_object('receipt_number', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_pelecard_payment(
  p_payment_id UUID,
  p_provider_transaction_id TEXT,
  p_approval_id TEXT,
  p_provider_status_code TEXT,
  p_amount NUMERIC,
  p_currency TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  payment_row public.payment_transactions%ROWTYPE;
  new_sale_id UUID;
  receipt TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT payment_row
  FROM public.payment_transactions
  WHERE id = p_payment_id AND provider = 'pelecard' AND operation = 'payment'
  FOR UPDATE;

  IF payment_row.status = 'succeeded' THEN
    IF payment_row.provider_transaction_id IS DISTINCT FROM p_provider_transaction_id
       OR payment_row.amount IS DISTINCT FROM p_amount
       OR payment_row.currency IS DISTINCT FROM p_currency THEN
      RAISE EXCEPTION 'finalization retry mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT receipt_number INTO receipt FROM public.sales WHERE id = payment_row.sale_id;
    RETURN to_jsonb(payment_row) || jsonb_build_object('receipt_number', receipt);
  END IF;

  IF payment_row.status NOT IN ('initiated', 'pending_provider', 'timed_out') THEN
    RAISE EXCEPTION 'payment cannot be finalized' USING ERRCODE = '23514';
  END IF;
  IF payment_row.amount IS DISTINCT FROM p_amount THEN
    RAISE EXCEPTION 'payment amount mismatch' USING ERRCODE = '23514';
  END IF;
  IF payment_row.currency IS DISTINCT FROM p_currency THEN
    RAISE EXCEPTION 'payment currency mismatch' USING ERRCODE = '23514';
  END IF;
  IF p_provider_transaction_id IS NULL
     OR length(btrim(p_provider_transaction_id)) NOT BETWEEN 1 AND 100
     OR p_approval_id IS NULL
     OR length(btrim(p_approval_id)) NOT BETWEEN 1 AND 100
     OR p_provider_status_code IS NULL
     OR length(btrim(p_provider_status_code)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid verified provider identifiers'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.sales (
    items,
    total,
    method,
    sale_date,
    created_by,
    discount,
    order_id,
    linked_order_info,
    payment_transaction_id
  ) VALUES (
    COALESCE(payment_row.checkout_snapshot -> 'items', '[]'::JSONB),
    payment_row.amount,
    'פלאקארד',
    COALESCE(
      NULLIF(payment_row.checkout_snapshot ->> 'sale_date', '')::DATE,
      CURRENT_DATE
    ),
    payment_row.created_by,
    NULLIF(payment_row.checkout_snapshot -> 'discount', 'null'::JSONB),
    payment_row.order_id,
    NULLIF(payment_row.checkout_snapshot -> 'linked_order_info', 'null'::JSONB),
    payment_row.id
  )
  RETURNING id, receipt_number INTO new_sale_id, receipt;

  IF payment_row.order_id IS NOT NULL THEN
    UPDATE public.orders
    SET payment_status = 'פלאקארד'
    WHERE id = payment_row.order_id;
  END IF;

  UPDATE public.payment_transactions
  SET provider_transaction_id = btrim(p_provider_transaction_id),
      approval_id = btrim(p_approval_id),
      provider_status_code = btrim(p_provider_status_code),
      status = 'succeeded',
      sale_id = new_sale_id,
      verified_at = NOW(),
      failure_code = NULL,
      failure_message = NULL
  WHERE id = payment_row.id
  RETURNING * INTO payment_row;

  RETURN to_jsonb(payment_row) || jsonb_build_object('receipt_number', receipt);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_pelecard_payment(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_pelecard_initiation(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_pelecard_initiation_uncertain(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_pelecard_payment(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_pelecard_payment(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_pelecard_payment(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reserve_pelecard_payment(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_pelecard_initiation(UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_pelecard_initiation_uncertain(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pelecard_payment(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_pelecard_payment(UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_pelecard_payment(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT)
  TO service_role;

COMMENT ON COLUMN public.payment_transactions.provider_redirect_url IS
  'Sanitized hosted checkout URL. Service-side retry continuity only; never card data.';

-- Existing externally processed credit remains 'אשראי'; verified provider
-- finalization is the only path that writes the distinct 'פלאקארד' method.
