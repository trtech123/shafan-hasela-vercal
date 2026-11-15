-- Shared order balance contract for the independently developed physical
-- terminal collection. Safe before or after 202611150002: no terminal tables
-- or functions are changed here.
BEGIN;

CREATE FUNCTION public.physical_order_source_is_safe(payload jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $$
BEGIN
  IF pg_catalog.jsonb_typeof(payload)<>'object' OR
    NOT payload ?& ARRAY['orderId','originalTotal','paidBefore','balanceBefore',
      'collected','vatApplicable','customerKind','participants'] OR
    EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(payload) k(key_name)
      WHERE key_name <> ALL(ARRAY['orderId','originalTotal','paidBefore',
        'balanceBefore','collected','quoteId','quoteDiscount','vatApplicable',
        'customerKind','participants','pricePerPerson']))
  THEN RETURN false; END IF;
  IF coalesce(payload->>'orderId','') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' OR
    pg_catalog.jsonb_typeof(payload->'originalTotal')<>'number' OR
    pg_catalog.jsonb_typeof(payload->'paidBefore')<>'number' OR
    pg_catalog.jsonb_typeof(payload->'balanceBefore')<>'number' OR
    pg_catalog.jsonb_typeof(payload->'collected')<>'number' OR
    (payload->>'originalTotal')::numeric<=0 OR
    (payload->>'paidBefore')::numeric<0 OR
    (payload->>'balanceBefore')::numeric<=0 OR
    (payload->>'collected')::numeric<=0 OR
    (payload->>'originalTotal')::numeric-(payload->>'paidBefore')::numeric
      <> (payload->>'balanceBefore')::numeric OR
    (payload->>'collected')::numeric>(payload->>'balanceBefore')::numeric OR
    pg_catalog.jsonb_typeof(payload->'vatApplicable')<>'boolean' OR
    payload->>'customerKind' NOT IN ('person','organization') OR
    pg_catalog.jsonb_typeof(payload->'participants')<>'number' OR
    (payload->>'participants')::numeric<=0
  THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END $$;

ALTER TABLE public.payment_transactions
  DROP CONSTRAINT payment_transactions_checkout_snapshot_check;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_checkout_snapshot_check CHECK (
    pg_catalog.jsonb_typeof(checkout_snapshot)='object' AND
    (public.payment_checkout_snapshot_is_safe(checkout_snapshot) OR
      (provider='pelecard' AND operation='payment' AND order_id IS NOT NULL AND
       idempotency_key LIKE 'physical-%' AND checkout_snapshot ? 'source_order' AND
       public.payment_checkout_snapshot_is_safe(checkout_snapshot-'source_order') AND
       public.physical_order_source_is_safe(checkout_snapshot->'source_order') AND
       checkout_snapshot #>> '{source_order,orderId}'=order_id::text AND
       (checkout_snapshot #>> '{source_order,collected}')::numeric=amount)));

CREATE OR REPLACE FUNCTION public.guard_hosted_after_noncard_partial() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.provider='pelecard' AND NEW.operation='payment' AND NEW.order_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.payper_noncard_payments n WHERE n.order_id=NEW.order_id)
    AND (NEW.idempotency_key='physical-'||NEW.id::text AND
      NEW.checkout_snapshot->'source_order'->>'orderId'=NEW.order_id::text AND
      (NEW.checkout_snapshot->'source_order'->>'collected')::numeric=NEW.amount) IS NOT TRUE
  THEN RAISE EXCEPTION 'hosted_partial_balance_unsupported' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.physical_order_source_is_safe(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.physical_order_source_is_safe(jsonb) TO service_role;
COMMIT;
