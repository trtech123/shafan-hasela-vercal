-- ============================================================
-- PELECARD PAYMENT LEDGER
-- Additive schema only. Existing manual/external credit payments remain
-- represented by 'אשראי'; verified hosted Pelecard payments use 'פלאקארד'.
-- ============================================================

CREATE OR REPLACE FUNCTION public.payment_json_is_safe(payload JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  item_key TEXT;
  item_value JSONB;
  normalized_key TEXT;
BEGIN
  IF jsonb_typeof(payload) = 'object' THEN
    FOR item_key, item_value IN SELECT * FROM jsonb_each(payload)
    LOOP
      normalized_key := regexp_replace(lower(item_key), '[^a-z0-9]', '', 'g');

      IF normalized_key = ANY (ARRAY[
        'pan', 'cvv', 'cvc', 'cardnumber', 'cardexpiry', 'expirydate',
        'expiredate', 'cardtoken', 'cardholderid', 'nationalid'
      ]) THEN
        RETURN FALSE;
      END IF;

      IF NOT public.payment_json_is_safe(item_value) THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(payload) = 'array' THEN
    FOR item_value IN SELECT * FROM jsonb_array_elements(payload)
    LOOP
      IF NOT public.payment_json_is_safe(item_value) THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

CREATE TABLE public.payment_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL DEFAULT 'pelecard'
    CHECK (provider = 'pelecard'),
  operation TEXT NOT NULL DEFAULT 'payment'
    CHECK (operation IN ('payment', 'refund', 'void')),
  parent_transaction_id UUID
    REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES public.orders(id) ON DELETE RESTRICT,
  sale_id UUID,
  provider_session_id TEXT,
  provider_transaction_id TEXT,
  approval_id TEXT,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN (
    'initiated',
    'pending_provider',
    'succeeded',
    'failed',
    'timed_out',
    'refund_pending',
    'refunded',
    'void_pending',
    'voided'
  )),
  idempotency_key TEXT NOT NULL
    CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 100),
  provider_status_code TEXT,
  failure_code TEXT,
  failure_message TEXT,
  checkout_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (
      jsonb_typeof(checkout_snapshot) = 'object'
      AND public.payment_json_is_safe(checkout_snapshot)
    ),
  created_by UUID,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_transactions_parent_required CHECK (
    (operation = 'payment' AND parent_transaction_id IS NULL)
    OR (operation IN ('refund', 'void') AND parent_transaction_id IS NOT NULL)
  ),
  CONSTRAINT payment_transactions_parent_not_self CHECK (
    parent_transaction_id IS NULL OR parent_transaction_id <> id
  ),
  CONSTRAINT payment_transactions_provider_session_nonblank CHECK (
    provider_session_id IS NULL OR btrim(provider_session_id) <> ''
  ),
  CONSTRAINT payment_transactions_provider_id_nonblank CHECK (
    provider_transaction_id IS NULL OR btrim(provider_transaction_id) <> ''
  ),
  CONSTRAINT payment_transactions_approval_id_nonblank CHECK (
    approval_id IS NULL OR btrim(approval_id) <> ''
  ),
  CONSTRAINT payment_transactions_provider_status_code_length CHECK (
    provider_status_code IS NULL OR length(provider_status_code) <= 100
  ),
  CONSTRAINT payment_transactions_failure_code_length CHECK (
    failure_code IS NULL OR length(failure_code) <= 100
  ),
  CONSTRAINT payment_transactions_failure_message_length CHECK (
    failure_message IS NULL OR length(failure_message) <= 500
  ),
  UNIQUE (provider, idempotency_key)
);

CREATE UNIQUE INDEX uq_payment_transactions_provider_transaction
  ON public.payment_transactions(provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX uq_payment_transactions_sale
  ON public.payment_transactions(sale_id)
  WHERE sale_id IS NOT NULL;

CREATE INDEX idx_payment_transactions_order_id
  ON public.payment_transactions(order_id);

CREATE INDEX idx_payment_transactions_parent_id
  ON public.payment_transactions(parent_transaction_id);

CREATE INDEX idx_payment_transactions_created_by
  ON public.payment_transactions(created_by);

CREATE INDEX idx_payment_transactions_pending
  ON public.payment_transactions(created_at)
  WHERE status IN ('initiated', 'pending_provider', 'timed_out');

CREATE TABLE public.payment_transaction_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_transaction_id UUID NOT NULL
    REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN (
    'initiated',
    'pending_provider',
    'succeeded',
    'failed',
    'timed_out',
    'refund_pending',
    'refunded',
    'void_pending',
    'voided'
  )),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (
      jsonb_typeof(metadata) = 'object'
      AND public.payment_json_is_safe(metadata)
    ),
  actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_transaction_events_transaction_created
  ON public.payment_transaction_events(payment_transaction_id, created_at);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_transaction_id UUID;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_payment_transaction_id_fkey
  FOREIGN KEY (payment_transaction_id)
  REFERENCES public.payment_transactions(id) ON DELETE RESTRICT;

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_sale_id_fkey
  FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_sales_payment_transaction_id
  ON public.sales(payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_status_check CHECK (
    payment_status IN ('לא שולם', 'שובר', 'אשראי', 'צ''ק', 'מזומן', 'פלאקארד')
  ) NOT VALID;

ALTER TABLE public.orders
  VALIDATE CONSTRAINT orders_payment_status_check;

CREATE OR REPLACE FUNCTION public.reject_payment_ledger_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'payment ledger rows are immutable' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_payment_transaction_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF ROW(
    NEW.provider,
    NEW.operation,
    NEW.parent_transaction_id,
    NEW.order_id,
    NEW.amount,
    NEW.currency,
    NEW.idempotency_key,
    NEW.checkout_snapshot,
    NEW.created_by,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.provider,
    OLD.operation,
    OLD.parent_transaction_id,
    OLD.order_id,
    OLD.amount,
    OLD.currency,
    OLD.idempotency_key,
    OLD.checkout_snapshot,
    OLD.created_by,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'payment transaction identity is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.provider_session_id IS NOT NULL
     AND NEW.provider_session_id IS DISTINCT FROM OLD.provider_session_id THEN
    RAISE EXCEPTION 'provider session id is immutable once assigned'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.provider_transaction_id IS NOT NULL
     AND NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id THEN
    RAISE EXCEPTION 'provider transaction id is immutable once assigned'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.approval_id IS NOT NULL
     AND NEW.approval_id IS DISTINCT FROM OLD.approval_id THEN
    RAISE EXCEPTION 'approval id is immutable once assigned'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.sale_id IS NOT NULL AND NEW.sale_id IS DISTINCT FROM OLD.sale_id THEN
    RAISE EXCEPTION 'sale link is immutable once assigned'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.verified_at IS NOT NULL
     AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION 'verification time is immutable once assigned'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_payment_transaction_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.payment_transaction_events (
      payment_transaction_id,
      event_type,
      status,
      metadata,
      actor_id
    ) VALUES (
      NEW.id,
      'created',
      NEW.status,
      jsonb_strip_nulls(jsonb_build_object(
        'provider_status_code', NEW.provider_status_code,
        'failure_code', NEW.failure_code
      )),
      COALESCE(auth.uid(), NEW.created_by)
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.payment_transaction_events (
      payment_transaction_id,
      event_type,
      status,
      metadata,
      actor_id
    ) VALUES (
      NEW.id,
      'status_changed',
      NEW.status,
      jsonb_strip_nulls(jsonb_build_object(
        'previous_status', OLD.status,
        'provider_status_code', NEW.provider_status_code,
        'failure_code', NEW.failure_code
      )),
      COALESCE(auth.uid(), NEW.created_by)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_order_pelecard_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND NEW.payment_status = 'פלאקארד' THEN
      RAISE EXCEPTION 'verified Pelecard state is server-managed'
        USING ERRCODE = '42501';
    END IF;
  ELSIF COALESCE(auth.role(), '') <> 'service_role'
        AND (
          NEW.payment_status = 'פלאקארד'
          OR OLD.payment_status = 'פלאקארד'
        )
        AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    RAISE EXCEPTION 'verified Pelecard state is server-managed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_sale_pelecard_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND (NEW.method = 'פלאקארד' OR NEW.payment_transaction_id IS NOT NULL) THEN
      RAISE EXCEPTION 'verified Pelecard sales are server-managed'
        USING ERRCODE = '42501';
    END IF;
  ELSIF COALESCE(auth.role(), '') <> 'service_role'
        AND (
          NEW.method = 'פלאקארד'
          OR OLD.method = 'פלאקארד'
          OR NEW.payment_transaction_id IS NOT NULL
          OR OLD.payment_transaction_id IS NOT NULL
        )
        AND ROW(NEW.method, NEW.payment_transaction_id)
            IS DISTINCT FROM ROW(OLD.method, OLD.payment_transaction_id) THEN
    RAISE EXCEPTION 'verified Pelecard sales are server-managed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_transactions_identity
  BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.protect_payment_transaction_identity();

CREATE TRIGGER trg_payment_transactions_no_delete
  BEFORE DELETE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.reject_payment_ledger_delete();

CREATE TRIGGER trg_payment_transaction_events_immutable
  BEFORE UPDATE OR DELETE ON public.payment_transaction_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_payment_ledger_delete();

CREATE TRIGGER trg_payment_transactions_created_event
  AFTER INSERT ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.record_payment_transaction_event();

CREATE TRIGGER trg_payment_transactions_status_event
  AFTER UPDATE OF status ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.record_payment_transaction_event();

CREATE TRIGGER trg_payment_transactions_updated_at
  BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_orders_protect_pelecard_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_order_pelecard_state();

CREATE TRIGGER trg_orders_protect_pelecard_update
  BEFORE UPDATE OF payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_order_pelecard_state();

CREATE TRIGGER trg_sales_protect_pelecard_insert
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.protect_sale_pelecard_state();

CREATE TRIGGER trg_sales_protect_pelecard_update
  BEFORE UPDATE OF method, payment_transaction_id ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.protect_sale_pelecard_state();

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transaction_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment transactions: staff read"
  ON public.payment_transactions
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin_or_ops()) OR (SELECT public.is_cashier()));

CREATE POLICY "payment transaction events: staff read"
  ON public.payment_transaction_events
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin_or_ops()) OR (SELECT public.is_cashier()));

REVOKE ALL ON public.payment_transactions FROM anon;
REVOKE ALL ON public.payment_transaction_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payment_transactions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payment_transaction_events FROM anon, authenticated;
GRANT SELECT ON public.payment_transactions TO authenticated;
GRANT SELECT ON public.payment_transaction_events TO authenticated;
GRANT ALL ON public.payment_transactions TO service_role;
GRANT ALL ON public.payment_transaction_events TO service_role;

REVOKE ALL ON FUNCTION public.payment_json_is_safe(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_json_is_safe(JSONB) TO service_role;

COMMENT ON TABLE public.payment_transactions IS
  'Server-managed Pelecard operation ledger. Contains no card data or raw provider payloads.';
COMMENT ON TABLE public.payment_transaction_events IS
  'Append-only sanitized lifecycle history for payment transactions.';
COMMENT ON COLUMN public.sales.payment_transaction_id IS
  'Verified provider payment finalized atomically by server-side code; NULL for manual/external payments.';
