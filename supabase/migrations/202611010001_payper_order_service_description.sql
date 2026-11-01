-- Prospective only. Preserve payment reservation and finalization behavior.
-- Existing payment snapshots remain untouched; dispatch is not activated.
BEGIN;

CREATE FUNCTION public.freeze_pelecard_order_service_description() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  order_number text;
  service_name text;
BEGIN
  IF NEW.provider IS DISTINCT FROM 'pelecard'
    OR NEW.operation IS DISTINCT FROM 'payment'
    OR NEW.status IS DISTINCT FROM 'initiated'
    OR NEW.order_id IS NULL
    OR (CASE WHEN pg_catalog.jsonb_typeof(NEW.checkout_snapshot->'items') = 'array'
      THEN pg_catalog.jsonb_array_length(NEW.checkout_snapshot->'items')
      ELSE 0 END) <> 1
  THEN RETURN NEW; END IF;

  SELECT o.order_number, nullif(pg_catalog.btrim(a.name), '')
    INTO order_number, service_name
  FROM public.orders o LEFT JOIN public.activities a ON a.id = o.activity_id
  WHERE o.id = NEW.order_id;

  -- Only the server-created one-line order snapshot has this exact shape.
  -- A missing activity leaves checkout unchanged and is held before Payper dispatch.
  IF service_name IS NOT NULL AND pg_catalog.length(service_name) <= 200
    AND NEW.checkout_snapshot->'items'->0->>'id' = NEW.order_id::text
    AND NEW.checkout_snapshot->'items'->0->>'name' = order_number
    AND NEW.checkout_snapshot->'linked_order_info'->>'order_number' = order_number
  THEN
    NEW.checkout_snapshot := pg_catalog.jsonb_set(
      NEW.checkout_snapshot, '{items,0,name}', pg_catalog.to_jsonb(service_name), false);
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.freeze_pelecard_order_service_description()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_freeze_pelecard_order_service_description
  BEFORE INSERT ON public.payment_transactions FOR EACH ROW
  EXECUTE FUNCTION public.freeze_pelecard_order_service_description();

-- Runs after trg_payper_eligible_payment (alphabetical trigger order). An
-- order-number-only line is a durable manual obligation immediately after
-- verified success, even if the worker has not been deployed or scheduled.
CREATE FUNCTION public.hold_payper_missing_service_description() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.provider = 'pelecard' AND NEW.operation = 'payment'
    AND NEW.status = 'succeeded' AND NEW.order_id IS NOT NULL
  THEN
    UPDATE public.payper_document_ledger l
      SET state = 'source_blocked',
          reconciliation_code = 'service_description_required',
          updated_at = pg_catalog.clock_timestamp()
    FROM public.orders o
    WHERE l.payment_id = NEW.id AND l.order_id = o.id
      AND o.id = NEW.order_id AND l.state = 'eligible'
      AND NEW.checkout_snapshot->'items'->0->>'name' = o.order_number;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.hold_payper_missing_service_description()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_z_hold_payper_missing_service_description
  AFTER INSERT OR UPDATE OF status ON public.payment_transactions FOR EACH ROW
  EXECUTE FUNCTION public.hold_payper_missing_service_description();

COMMIT;
