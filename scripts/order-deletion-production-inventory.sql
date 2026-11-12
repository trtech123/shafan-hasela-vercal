-- Read-only production inventory. This script never changes an order.
SELECT o.id, o.order_number, o.client_name, o.created_at::date AS created_date,
       o.activity_date, o.status, o.payment_status,
       array_remove(ARRAY[
         CASE WHEN EXISTS (SELECT 1 FROM public.payment_transactions p WHERE p.order_id=o.id OR p.checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number) THEN 'payment_transaction' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.sales s WHERE s.order_id=o.id OR s.linked_order_info->>'order_number'=o.order_number) THEN 'sale' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.manual_order_payments m WHERE m.order_id=o.id) THEN 'manual_payment' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.pelecard_live_attempts p WHERE p.order_id=o.id) THEN 'pelecard_attempt' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.pelecard_controlled_live_control p WHERE p.order_id=o.id) THEN 'pelecard_control' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.payper_document_ledger d WHERE d.order_id=o.id) THEN 'payper_ledger' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.payper_payment_billing_snapshots b WHERE b.order_id=o.id) THEN 'billing_snapshot' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.immediate_accounting_preparations a WHERE a.order_id=o.id) THEN 'accounting_preparation' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.immediate_accounting_payment_evidence e WHERE e.order_id=o.id) THEN 'accounting_evidence' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.hakafa_vouchers v WHERE v.order_id=o.id) THEN 'voucher' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.accounting_documents d WHERE d.source_type='order' AND d.source_id=o.id::text) THEN 'accounting_document' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.accounting_events e WHERE e.source_type='order' AND e.source_id=o.id::text) THEN 'accounting_event' END,
         CASE WHEN o.quote_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.converted_to_order_id=o.id) THEN 'quotation' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.blocked_slots b WHERE b.source_order_id=o.id) THEN 'schedule_block' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.customer_snapshots c WHERE c.order_id=o.id) THEN 'customer_snapshot' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.order_confirmation_revisions c WHERE c.order_id=o.id) THEN 'confirmation' END,
         CASE WHEN EXISTS (SELECT 1 FROM public.order_delivery_attempts d WHERE d.order_id=o.id) THEN 'delivery' END,
         CASE WHEN o.instructor_id IS NOT NULL OR o.instructor_notified THEN 'instructor_commitment' END
       ], NULL) AS dependencies
FROM public.orders o
ORDER BY o.created_at DESC;
