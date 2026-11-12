-- Keep historical finance and confirmation records intact. The only cascading
-- child allowed to disappear is an automatically generated scheduling block.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

-- Replace the archive release's blanket deletion rejection with this guard.
DROP TRIGGER IF EXISTS trg_reject_order_hard_delete ON public.orders;

CREATE FUNCTION public.guard_order_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE related boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'order_delete_forbidden' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.current_setting('app.confirmed_order_delete', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'order_delete_confirmation_required' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.payment_status IS DISTINCT FROM 'לא שולם' THEN
    RAISE EXCEPTION 'order_delete_payment_status' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status NOT IN ('בוטל', 'ממתין לאישור') THEN
    RAISE EXCEPTION 'order_delete_status_not_eligible' USING ERRCODE = 'P0001';
  END IF;

  -- Include attempts with uncertain outcomes and links held only by number.
  IF EXISTS (SELECT 1 FROM public.payment_transactions p WHERE p.order_id = OLD.id
       OR p.checkout_snapshot->'linked_order_info'->>'order_number' = OLD.order_number)
    OR EXISTS (SELECT 1 FROM public.sales s WHERE s.order_id = OLD.id
       OR s.linked_order_info->>'order_number' = OLD.order_number)
    OR EXISTS (SELECT 1 FROM public.manual_order_payments m WHERE m.order_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.pelecard_live_attempts a WHERE a.order_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.pelecard_controlled_live_control c WHERE c.order_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.payper_document_ledger d WHERE d.order_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.payper_payment_billing_snapshots b WHERE b.order_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.immediate_accounting_preparations a WHERE a.order_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.immediate_accounting_payment_evidence e WHERE e.order_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.hakafa_vouchers v WHERE v.order_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.accounting_documents d
       WHERE d.source_type = 'order' AND d.source_id = OLD.id::text)
    OR EXISTS (SELECT 1 FROM public.accounting_events e
       WHERE e.source_type = 'order' AND e.source_id = OLD.id::text) THEN
    RAISE EXCEPTION 'order_delete_financial_dependency' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.quote_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.quotes q WHERE q.converted_to_order_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'order_delete_quotation_link' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.instructor_id IS NOT NULL OR OLD.instructor_notified THEN
    RAISE EXCEPTION 'order_delete_instructor_commitment' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.blocked_slots b WHERE b.source_order_id = OLD.id
       AND (OLD.status <> 'בוטל' OR b.block_date >= CURRENT_DATE)) THEN
    RAISE EXCEPTION 'order_delete_scheduling_block' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_snapshots c WHERE c.order_id = OLD.id) THEN
    RAISE EXCEPTION 'order_delete_customer_snapshot' USING ERRCODE = 'P0001';
  END IF;

  -- These relations are installed by the separate confirmation release. Check
  -- them when present even if that release is not in this branch's migration set.
  IF pg_catalog.to_regclass('public.order_confirmation_revisions') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.order_confirmation_revisions WHERE order_id = $1)'
      INTO related USING OLD.id;
    IF related THEN
      RAISE EXCEPTION 'order_delete_confirmation_history' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF pg_catalog.to_regclass('public.order_delivery_attempts') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.order_delivery_attempts WHERE order_id = $1)'
      INTO related USING OLD.id;
    IF related THEN
      RAISE EXCEPTION 'order_delete_confirmation_history' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_order_delete() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_order_delete BEFORE DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_delete();

CREATE FUNCTION public.delete_order(
  p_order_id uuid, p_confirm_no_external_commitments boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE deleted_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'order_delete_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_delete_not_found' USING ERRCODE = '22023';
  END IF;
  IF p_confirm_no_external_commitments IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'order_delete_confirmation_required' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_catalog.set_config('app.confirmed_order_delete', 'true', true);
  DELETE FROM public.orders WHERE id = p_order_id RETURNING id INTO deleted_id;
  PERFORM pg_catalog.set_config('app.confirmed_order_delete', 'false', true);
  IF deleted_id IS NULL THEN
    RAISE EXCEPTION 'order_delete_not_found' USING ERRCODE = 'P0001';
  END IF;
  RETURN pg_catalog.jsonb_build_object('id', deleted_id, 'deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_order(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_order(uuid,boolean) TO authenticated;
COMMIT;
