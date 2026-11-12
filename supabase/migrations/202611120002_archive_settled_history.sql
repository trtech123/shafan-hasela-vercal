-- Allow settled historical orders with retained dependencies in the archive.
-- Safe deletion is installed separately after the original archive migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';
CREATE OR REPLACE FUNCTION public.guard_order_archive_change() RETURNS trigger
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
    -- Historical and cancelled orders may retain financial and signed records.
    -- They must be settled so archiving cannot interrupt payment or invoicing.
    IF OLD.activity_date < CURRENT_DATE OR OLD.status = 'בוטל' THEN
      IF EXISTS (SELECT 1 FROM public.payment_transactions p WHERE p.order_id = OLD.id
        AND p.status IN ('initiated','pending_provider','refund_pending','void_pending','timed_out'))
        OR EXISTS (SELECT 1 FROM public.payper_document_ledger d WHERE d.order_id = OLD.id
          AND d.state <> 'succeeded')
        OR EXISTS (SELECT 1 FROM public.accounting_events e
          WHERE e.source_type = 'order' AND e.source_id = OLD.id::text
          AND e.status <> 'succeeded') THEN
        RAISE EXCEPTION 'order_archive_unsettled_dependency' USING ERRCODE = 'P0001';
      END IF;
    ELSE
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
COMMIT;
