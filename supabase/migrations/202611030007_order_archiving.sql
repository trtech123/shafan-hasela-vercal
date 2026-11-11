-- Order archiving is independent of business cancellation and payment state.
-- Apply before deploying the Orders UI. No existing rows are changed.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT orders_archive_actor_check
    CHECK (archived_at IS NOT NULL OR archived_by IS NULL);

CREATE INDEX orders_active_created_idx ON public.orders(created_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX orders_archived_created_idx ON public.orders(archived_at DESC)
  WHERE archived_at IS NOT NULL;

-- Keep the existing read-only operational views consistent with the UI.
-- Revenue remains historical and therefore includes archived paid orders.
CREATE OR REPLACE VIEW public.dashboard_stats AS
SELECT
  (SELECT COUNT(*) FROM public.orders WHERE archived_at IS NULL AND status NOT IN ('בוטל')) AS active_orders,
  (SELECT COUNT(*) FROM public.orders WHERE archived_at IS NULL AND activity_date = CURRENT_DATE) AS orders_today,
  (SELECT COUNT(*) FROM public.leads WHERE status = 'פתוח') AS open_leads,
  (SELECT COUNT(*) FROM public.quotes WHERE status IN ('טיוטה', 'נשלחה', 'ממתינה לאישור')) AS pending_quotes,
  (SELECT COALESCE(SUM(total_price), 0) FROM public.orders
    WHERE status = 'שולם'
    AND date_trunc('month', activity_date) = date_trunc('month', CURRENT_DATE)) AS revenue_this_month,
  (SELECT COUNT(*) FROM public.tasks WHERE status IN ('פתוחה', 'בביצוע')
    AND due_date <= CURRENT_DATE + INTERVAL '7 days') AS tasks_due_soon;

CREATE OR REPLACE VIEW public.instructor_schedule AS
SELECT
  o.id AS order_id, o.order_number, o.activity_date, o.start_time, o.end_time,
  o.site, o.num_participants, o.status, o.client_name, o.organization,
  o.instructor_notified, a.name AS activity_name, a.duration_hours,
  i.id AS instructor_id, i.full_name AS instructor_name,
  i.phone AS instructor_phone, i.email AS instructor_email
FROM public.orders o
LEFT JOIN public.activities a ON a.id = o.activity_id
LEFT JOIN public.instructors i ON i.id = o.instructor_id
WHERE o.archived_at IS NULL AND o.status != 'בוטל';

-- Existing UPDATE policies include operations staff and instructors. A trigger
-- protects archive columns even when an UPDATE bypasses the RPC.
CREATE FUNCTION public.guard_order_archive_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE has_confirmation boolean;
BEGIN
  -- An archive transition cannot simultaneously edit the business record.
  -- Once archived, only restoration (or FK cleanup of creator/actor profiles)
  -- may update this row.
  IF (OLD.archived_at IS NOT NULL OR NEW.archived_at IS DISTINCT FROM OLD.archived_at)
     AND ((pg_catalog.to_jsonb(NEW) - 'archived_at' - 'archived_by' - 'updated_at' - 'created_by')
       IS DISTINCT FROM
       (pg_catalog.to_jsonb(OLD) - 'archived_at' - 'archived_by' - 'updated_at' - 'created_by')
       OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NOT (
         OLD.archived_at IS NOT NULL AND OLD.created_by IS NOT NULL
         AND NEW.created_by IS NULL AND NOT EXISTS (
           SELECT 1 FROM public.profiles p WHERE p.id = OLD.created_by
         )
       ))) THEN
    RAISE EXCEPTION 'order_archive_business_update_forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.archived_at IS NOT DISTINCT FROM NEW.archived_at
     AND OLD.archived_by IS NOT DISTINCT FROM NEW.archived_by THEN
    RETURN NEW;
  END IF;

  -- Profile deletion uses ON DELETE SET NULL for the archived actor.
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
     AND OLD.archived_by IS NOT NULL AND NEW.archived_by IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.archived_by) THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'order_archive_forbidden' USING ERRCODE = '42501';
  END IF;

  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    IF pg_catalog.current_setting('app.order_archive_confirmed', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'order_archive_confirmation_required' USING ERRCODE = 'P0001';
    END IF;
    -- A financial link may be pending, failed, settled or awaiting a document.
    IF OLD.payment_status IS DISTINCT FROM 'לא שולם'
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR EXISTS (SELECT 1 FROM public.payment_transactions p WHERE p.order_id = OLD.id
                  OR p.checkout_snapshot->'linked_order_info'->>'order_number' = OLD.order_number)
       OR EXISTS (SELECT 1 FROM public.sales s WHERE s.order_id = OLD.id
                  OR s.linked_order_info->>'order_number' = OLD.order_number)
       OR EXISTS (SELECT 1 FROM public.manual_order_payments m WHERE m.order_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.immediate_accounting_preparations a WHERE a.order_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.immediate_accounting_payment_evidence e WHERE e.order_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.payper_document_ledger d WHERE d.order_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.payper_payment_billing_snapshots b WHERE b.order_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.pelecard_live_attempts a WHERE a.order_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.pelecard_controlled_live_control c WHERE c.order_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.hakafa_vouchers v WHERE v.order_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.accounting_documents d
                  WHERE d.source_type = 'order' AND d.source_id = OLD.id::text)
       OR EXISTS (SELECT 1 FROM public.accounting_events e
                  WHERE e.source_type = 'order' AND e.source_id = OLD.id::text) THEN
      RAISE EXCEPTION 'order_archive_financial_dependency' USING ERRCODE = 'P0001';
    END IF;

    IF OLD.status = 'ממתין לאישור' THEN
      -- An already prepared or sent customer confirmation is a commitment,
      -- even when the order has not yet reached the approved status. These
      -- tables are installed by a separate release and may be absent.
      IF pg_catalog.to_regclass('public.order_confirmation_revisions') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.order_confirmation_revisions WHERE order_id = $1)'
          INTO has_confirmation USING OLD.id;
        IF has_confirmation THEN
          RAISE EXCEPTION 'order_archive_confirmation_history' USING ERRCODE = 'P0001';
        END IF;
      END IF;
      IF pg_catalog.to_regclass('public.order_delivery_attempts') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.order_delivery_attempts WHERE order_id = $1)'
          INTO has_confirmation USING OLD.id;
        IF has_confirmation THEN
          RAISE EXCEPTION 'order_archive_confirmation_history' USING ERRCODE = 'P0001';
        END IF;
      END IF;
      IF OLD.quote_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.quotes q WHERE q.converted_to_order_id = OLD.id
      ) THEN
        RAISE EXCEPTION 'order_archive_quotation_link' USING ERRCODE = 'P0001';
      END IF;
      IF OLD.instructor_id IS NOT NULL OR OLD.instructor_notified THEN
        RAISE EXCEPTION 'order_archive_instructor_commitment' USING ERRCODE = 'P0001';
      END IF;
      IF EXISTS (SELECT 1 FROM public.blocked_slots b WHERE b.source_order_id = OLD.id) THEN
        RAISE EXCEPTION 'order_archive_scheduling_block' USING ERRCODE = 'P0001';
      END IF;
    ELSIF OLD.status = 'בוטל' THEN
      IF EXISTS (SELECT 1 FROM public.blocked_slots b
                 WHERE b.source_order_id = OLD.id AND b.block_date >= CURRENT_DATE) THEN
        RAISE EXCEPTION 'order_archive_scheduling_block' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      RAISE EXCEPTION 'order_archive_status_not_eligible' USING ERRCODE = 'P0001';
    END IF;

    NEW.archived_at := pg_catalog.clock_timestamp();
    NEW.archived_by := auth.uid();
  ELSIF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN
    NEW.archived_by := NULL;
  ELSE
    RAISE EXCEPTION 'order_archive_invalid_transition' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_order_archive_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_order_archive_change
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_archive_change();

-- Direct permanent deletion would break historical links (some FKs CASCADE or
-- SET NULL), so all client deletion is forbidden once archiving is available.
CREATE FUNCTION public.reject_order_hard_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'order_hard_delete_forbidden' USING ERRCODE = 'P0001';
END;
$$;
REVOKE ALL ON FUNCTION public.reject_order_hard_delete() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_reject_order_hard_delete
  BEFORE DELETE ON public.orders FOR EACH ROW
  EXECUTE FUNCTION public.reject_order_hard_delete();

-- POS can link a sale to an order independently of the payment RPCs. Locking
-- the order row serializes this link with archive_order's FOR UPDATE lock.
CREATE FUNCTION public.guard_archived_order_sale_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE archived timestamptz;
BEGIN
  IF NEW.order_id IS NULL THEN RETURN NEW; END IF;
  SELECT o.archived_at INTO archived FROM public.orders o
    WHERE o.id = NEW.order_id FOR SHARE;
  IF archived IS NOT NULL THEN
    RAISE EXCEPTION 'order_archive_sale_link_forbidden' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_archived_order_sale_link() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_archived_order_sale_link
  BEFORE INSERT OR UPDATE OF order_id ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_sale_link();

-- These links are the database boundary for hosted/manual/POS payment,
-- vouchers, Payper and accounting preparation. A row lock serializes each
-- new link with archive_order; updates of existing financial rows are not
-- affected unless they try to change the linked order.
CREATE FUNCTION public.guard_archived_order_financial_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE archived timestamptz;
BEGIN
  IF NEW.order_id IS NULL THEN RETURN NEW; END IF;
  SELECT o.archived_at INTO archived FROM public.orders o
    WHERE o.id = NEW.order_id FOR SHARE;
  IF archived IS NOT NULL THEN
    RAISE EXCEPTION 'order_archive_financial_link_forbidden' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_archived_order_financial_link() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_archived_payment_transaction
  BEFORE INSERT OR UPDATE OF order_id ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_financial_link();
CREATE TRIGGER trg_guard_archived_manual_payment
  BEFORE INSERT OR UPDATE OF order_id ON public.manual_order_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_financial_link();
CREATE TRIGGER trg_guard_archived_accounting_preparation
  BEFORE INSERT OR UPDATE OF order_id ON public.immediate_accounting_preparations
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_financial_link();
CREATE TRIGGER trg_guard_archived_accounting_evidence
  BEFORE INSERT OR UPDATE OF order_id ON public.immediate_accounting_payment_evidence
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_financial_link();
CREATE TRIGGER trg_guard_archived_payper_ledger
  BEFORE INSERT OR UPDATE OF order_id ON public.payper_document_ledger
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_financial_link();
CREATE TRIGGER trg_guard_archived_payper_billing
  BEFORE INSERT OR UPDATE OF order_id ON public.payper_payment_billing_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_financial_link();
CREATE TRIGGER trg_guard_archived_voucher
  BEFORE INSERT OR UPDATE OF order_id ON public.hakafa_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_financial_link();
CREATE TRIGGER trg_guard_archived_pelecard_attempt
  BEFORE INSERT OR UPDATE OF order_id ON public.pelecard_live_attempts
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_financial_link();
CREATE TRIGGER trg_guard_archived_customer_snapshot
  BEFORE INSERT OR UPDATE OF order_id ON public.customer_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_financial_link();

-- Legacy payment/sale rows can identify an order by its number instead of
-- order_id. Protect that path too, using the same row lock as archive_order.
CREATE FUNCTION public.guard_archived_order_number_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE linked_number text; archived timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'payment_transactions' THEN
    linked_number := NEW.checkout_snapshot->'linked_order_info'->>'order_number';
  ELSE
    linked_number := NEW.linked_order_info->>'order_number';
  END IF;
  IF linked_number IS NULL THEN RETURN NEW; END IF;
  SELECT o.archived_at INTO archived FROM public.orders o
    WHERE o.order_number = linked_number FOR SHARE;
  IF archived IS NOT NULL THEN
    RAISE EXCEPTION 'order_archive_financial_link_forbidden' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_archived_order_number_link() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_archived_payment_order_number
  BEFORE INSERT OR UPDATE OF checkout_snapshot ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_number_link();
CREATE TRIGGER trg_guard_archived_sale_order_number
  BEFORE INSERT OR UPDATE OF linked_order_info ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_number_link();

CREATE FUNCTION public.guard_archived_order_accounting_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE archived timestamptz;
BEGIN
  IF NEW.source_type IS DISTINCT FROM 'order' OR NEW.source_id IS NULL THEN RETURN NEW; END IF;
  SELECT o.archived_at INTO archived FROM public.orders o
    WHERE o.id::text = pg_catalog.lower(NEW.source_id) FOR SHARE;
  IF archived IS NOT NULL THEN
    RAISE EXCEPTION 'order_archive_financial_link_forbidden' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_archived_order_accounting_source() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_archived_accounting_document
  BEFORE INSERT OR UPDATE OF source_type, source_id ON public.accounting_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_accounting_source();
CREATE TRIGGER trg_guard_archived_accounting_event
  BEFORE INSERT OR UPDATE OF source_type, source_id ON public.accounting_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_accounting_source();

CREATE FUNCTION public.guard_archived_order_quote_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE archived timestamptz;
BEGIN
  IF NEW.converted_to_order_id IS NULL THEN RETURN NEW; END IF;
  SELECT o.archived_at INTO archived FROM public.orders o
    WHERE o.id = NEW.converted_to_order_id FOR SHARE;
  IF archived IS NOT NULL THEN
    RAISE EXCEPTION 'order_archive_quotation_link_forbidden' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_archived_order_quote_link() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_archived_quote_link
  BEFORE INSERT OR UPDATE OF converted_to_order_id ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_quote_link();

CREATE FUNCTION public.guard_archived_order_block_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE archived timestamptz;
BEGIN
  IF NEW.source_order_id IS NULL THEN RETURN NEW; END IF;
  SELECT o.archived_at INTO archived FROM public.orders o
    WHERE o.id = NEW.source_order_id FOR SHARE;
  IF archived IS NOT NULL THEN
    RAISE EXCEPTION 'order_archive_scheduling_link_forbidden' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_archived_order_block_link() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_archived_order_block_link
  BEFORE INSERT OR UPDATE OF source_order_id ON public.blocked_slots
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_order_block_link();

CREATE FUNCTION public.archive_order(
  p_order_id uuid, p_confirm_no_external_commitments boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE result public.orders;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'order_archive_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_archive_invalid_id' USING ERRCODE = '22023';
  END IF;
  IF p_confirm_no_external_commitments IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'order_archive_confirmation_required' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO result FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_archive_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF result.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'order_archive_already_archived' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_catalog.set_config('app.order_archive_confirmed', 'true', true);
  UPDATE public.orders SET archived_at = pg_catalog.clock_timestamp()
    WHERE id = p_order_id RETURNING * INTO result;
  PERFORM pg_catalog.set_config('app.order_archive_confirmed', 'false', true);
  RETURN pg_catalog.jsonb_build_object('id', result.id, 'archived_at', result.archived_at);
END;
$$;

CREATE FUNCTION public.restore_order(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.orders;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'order_archive_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_archive_invalid_id' USING ERRCODE = '22023';
  END IF;
  -- Lock both operational tables before checking for a free slot. This blocks
  -- concurrent order/block inserts until the restore transaction commits.
  LOCK TABLE public.orders, public.blocked_slots IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO result FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_archive_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF result.archived_at IS NULL THEN
    RAISE EXCEPTION 'order_archive_not_archived' USING ERRCODE = 'P0001';
  END IF;
  IF result.status IS DISTINCT FROM 'בוטל' AND result.activity_date >= CURRENT_DATE THEN
    IF result.site IS NULL OR result.start_time IS NULL OR result.end_time IS NULL THEN
      RAISE EXCEPTION 'order_restore_schedule_review_required' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id <> result.id AND o.archived_at IS NULL
        AND o.status <> 'בוטל' AND o.activity_date = result.activity_date
        AND (o.site IS NULL OR o.site = result.site)
        AND (o.start_time IS NULL OR o.end_time IS NULL
             OR (o.start_time < result.end_time AND result.start_time < o.end_time))
    ) OR EXISTS (
      SELECT 1 FROM public.blocked_slots b
      WHERE b.block_date = result.activity_date
        AND (b.site IS NULL OR b.site = result.site)
        AND (b.start_time IS NULL OR b.end_time IS NULL
             OR (b.start_time < result.end_time AND result.start_time < b.end_time))
    ) THEN
      RAISE EXCEPTION 'order_restore_schedule_conflict' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  UPDATE public.orders SET archived_at = NULL, archived_by = NULL
    WHERE id = p_order_id RETURNING * INTO result;
  RETURN pg_catalog.jsonb_build_object('id', result.id, 'archived_at', result.archived_at);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_order(uuid,boolean), public.restore_order(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_order(uuid,boolean), public.restore_order(uuid)
  TO authenticated;

COMMIT;
