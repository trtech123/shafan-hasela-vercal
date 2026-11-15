-- Execute only with CLI --read-only. Returns counts, no row IDs or PII.
SELECT jsonb_build_object(
  'orders', (SELECT count(*) FROM public.orders),
  'order_payment_states', (SELECT coalesce(jsonb_object_agg(payment_status, count), '{}'::jsonb)
    FROM (SELECT coalesce(payment_status, '<null>') AS payment_status, count(*) AS count
      FROM public.orders GROUP BY payment_status) s),
  'sales', (SELECT count(*) FROM public.sales),
  'sale_methods', (SELECT coalesce(jsonb_object_agg(method, count), '{}'::jsonb)
    FROM (SELECT method, count(*) AS count FROM public.sales GROUP BY method) s),
  'verified_payments', (SELECT count(*) FROM public.payment_transactions
    WHERE operation='payment' AND status='succeeded' AND verified_at IS NOT NULL),
  'payment_operations', (SELECT coalesce(jsonb_object_agg(operation || ':' || status, count), '{}'::jsonb)
    FROM (SELECT operation, status, count(*) AS count FROM public.payment_transactions
      GROUP BY operation, status) s),
  'successful_payments_without_payper_row', (SELECT count(*)
    FROM public.payment_transactions p LEFT JOIN public.payper_document_ledger d ON d.payment_id=p.id
    WHERE p.operation='payment' AND p.status='succeeded' AND p.verified_at IS NOT NULL AND d.id IS NULL),
  'payper_states', (SELECT coalesce(jsonb_object_agg(state, count), '{}'::jsonb)
    FROM (SELECT state, count(*) AS count FROM public.payper_document_ledger GROUP BY state) s),
  'payper_succeeded_without_verified_payment', (SELECT count(*)
    FROM public.payper_document_ledger d LEFT JOIN public.payment_transactions p ON p.id=d.payment_id
    WHERE d.state='succeeded' AND (p.id IS NULL OR p.status<>'succeeded' OR p.verified_at IS NULL)),
  'payper_succeeded_amount_mismatch', (SELECT count(*)
    FROM public.payper_document_ledger d JOIN public.payment_transactions p ON p.id=d.payment_id
    JOIN public.sales s ON s.id=d.sale_id
    WHERE d.state='succeeded' AND p.amount IS DISTINCT FROM s.total),
  'legacy_accounting_states', (SELECT coalesce(jsonb_object_agg(status, count), '{}'::jsonb)
    FROM (SELECT status, count(*) AS count FROM public.accounting_events GROUP BY status) s),
  'new_bookkeeping_intake_installed', to_regclass('public.rivhit_bookkeeping_intake') IS NOT NULL,
  'new_bookkeeping_legs_installed', to_regclass('public.rivhit_bookkeeping_legs') IS NOT NULL
) AS aggregate_reconciliation;
