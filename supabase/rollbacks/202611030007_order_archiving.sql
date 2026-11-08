-- Manual rollback only. Run before rolling back the application.
-- Refuse to erase archive history; restore archived orders through the RPC first.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'order_archive_rollback_has_archived_rows';
  END IF;
END;
$$;

DROP FUNCTION public.archive_order(uuid,boolean);
DROP FUNCTION public.restore_order(uuid);
DROP TRIGGER trg_guard_archived_payment_transaction ON public.payment_transactions;
DROP TRIGGER trg_guard_archived_manual_payment ON public.manual_order_payments;
DROP TRIGGER trg_guard_archived_accounting_preparation ON public.immediate_accounting_preparations;
DROP TRIGGER trg_guard_archived_accounting_evidence ON public.immediate_accounting_payment_evidence;
DROP TRIGGER trg_guard_archived_payper_ledger ON public.payper_document_ledger;
DROP TRIGGER trg_guard_archived_payper_billing ON public.payper_payment_billing_snapshots;
DROP TRIGGER trg_guard_archived_voucher ON public.hakafa_vouchers;
DROP TRIGGER trg_guard_archived_pelecard_attempt ON public.pelecard_live_attempts;
DROP TRIGGER trg_guard_archived_customer_snapshot ON public.customer_snapshots;
DROP FUNCTION public.guard_archived_order_financial_link();
DROP TRIGGER trg_guard_archived_payment_order_number ON public.payment_transactions;
DROP TRIGGER trg_guard_archived_sale_order_number ON public.sales;
DROP FUNCTION public.guard_archived_order_number_link();
DROP TRIGGER trg_guard_archived_accounting_document ON public.accounting_documents;
DROP TRIGGER trg_guard_archived_accounting_event ON public.accounting_events;
DROP FUNCTION public.guard_archived_order_accounting_source();
DROP TRIGGER trg_guard_archived_quote_link ON public.quotes;
DROP FUNCTION public.guard_archived_order_quote_link();
DROP TRIGGER trg_guard_archived_order_block_link ON public.blocked_slots;
DROP FUNCTION public.guard_archived_order_block_link();
DROP TRIGGER trg_guard_archived_order_sale_link ON public.sales;
DROP FUNCTION public.guard_archived_order_sale_link();
DROP TRIGGER trg_guard_order_archive_change ON public.orders;
DROP FUNCTION public.guard_order_archive_change();
DROP TRIGGER trg_reject_order_hard_delete ON public.orders;
DROP FUNCTION public.reject_order_hard_delete();
DROP INDEX public.orders_active_created_idx;
DROP INDEX public.orders_archived_created_idx;
CREATE OR REPLACE VIEW public.dashboard_stats AS
SELECT
  (SELECT COUNT(*) FROM public.orders WHERE status NOT IN ('בוטל')) AS active_orders,
  (SELECT COUNT(*) FROM public.orders WHERE activity_date = CURRENT_DATE) AS orders_today,
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
WHERE o.status != 'בוטל';
ALTER TABLE public.orders
  DROP CONSTRAINT orders_archive_actor_check,
  DROP COLUMN archived_by,
  DROP COLUMN archived_at;
COMMIT;
