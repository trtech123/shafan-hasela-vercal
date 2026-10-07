-- 029 is reserved by the independent customer workstream. No dependency on it.
-- Additive order-payment entrypoint; preserves all historical ledger records.
BEGIN;

CREATE FUNCTION public.reserve_pelecard_order_payment(
  p_payment_id UUID, p_order_id UUID, p_created_by UUID,
  p_idempotency_key TEXT, p_amount NUMERIC, p_currency TEXT,
  p_checkout_snapshot JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  order_row public.orders%ROWTYPE;
  existing public.payment_transactions%ROWTYPE;
  snapshot JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_created_by
    AND role::text IN ('admin', 'operations')) THEN
    RAISE EXCEPTION 'order_payment_forbidden' USING ERRCODE = '42501';
  END IF;
  -- One short reservation per order, including different idempotency keys.
  SELECT * INTO order_row FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_payable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO existing FROM public.payment_transactions
    WHERE provider = 'pelecard' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF existing.order_id IS DISTINCT FROM p_order_id
      OR existing.created_by IS DISTINCT FROM p_created_by
      OR existing.amount IS DISTINCT FROM p_amount
      OR existing.currency IS DISTINCT FROM p_currency THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23514';
    END IF;
    RETURN to_jsonb(existing) || jsonb_build_object('created', false);
  END IF;
  IF order_row.payment_status IS DISTINCT FROM 'לא שולם'
    OR order_row.status IN ('שולם', 'בוטל')
    OR order_row.total_price IS NULL OR order_row.total_price <= 0
    OR EXISTS (SELECT 1 FROM public.sales WHERE order_id = p_order_id)
    OR EXISTS (SELECT 1 FROM public.payment_transactions WHERE order_id = p_order_id
      AND operation = 'payment' AND status IN ('succeeded', 'refund_pending', 'refunded', 'void_pending', 'voided')) THEN
    RAISE EXCEPTION 'order_not_payable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_transactions WHERE order_id = p_order_id
    AND operation = 'payment' AND status IN ('initiated', 'pending_provider', 'timed_out')) THEN
    RAISE EXCEPTION 'order_payment_in_progress' USING ERRCODE = '23514';
  END IF;
  -- The browser amount is only an expectation. It never becomes the payable amount.
  IF p_amount IS DISTINCT FROM order_row.total_price OR p_currency IS DISTINCT FROM 'ILS' THEN
    RAISE EXCEPTION 'order_amount_mismatch' USING ERRCODE = '23514';
  END IF;
  snapshot := jsonb_build_object(
    'schema_version', 1,
    'items', jsonb_build_array(jsonb_build_object(
      'id', order_row.id::text, 'name', order_row.order_number,
      'qty', 1, 'customPrice', order_row.total_price)),
    'discount', NULL,
    'linked_order_info', jsonb_build_object(
      'order_number', order_row.order_number, 'client_name', order_row.client_name,
      'client_phone', order_row.client_phone, 'organization', COALESCE(order_row.organization, '')),
    'sale_date', CURRENT_DATE::text);
  RETURN public.reserve_pelecard_payment(p_payment_id, p_order_id, p_created_by,
    p_idempotency_key, order_row.total_price, 'ILS', snapshot);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_pelecard_order_payment(UUID,UUID,UUID,TEXT,NUMERIC,TEXT,JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_pelecard_order_payment(UUID,UUID,UUID,TEXT,NUMERIC,TEXT,JSONB)
  TO service_role;

-- Keep the payable order stable while hosted checkout can still charge it.
CREATE FUNCTION public.protect_pending_pelecard_order() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_transactions WHERE order_id = OLD.id
    AND operation = 'payment' AND status IN ('initiated','pending_provider','timed_out'))
    AND (ROW(NEW.total_price,NEW.price_per_person,NEW.num_participants,NEW.activity_id,NEW.status)
      IS DISTINCT FROM ROW(OLD.total_price,OLD.price_per_person,OLD.num_participants,OLD.activity_id,OLD.status)
      OR (NEW.payment_status IS DISTINCT FROM OLD.payment_status
        AND NOT (COALESCE(auth.role(),'') = 'service_role' AND NEW.payment_status = 'פלאקארד'))) THEN
    RAISE EXCEPTION 'order_payment_in_progress' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_pending_pelecard_order() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_protect_pending_pelecard_order BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_pending_pelecard_order();
COMMIT;
