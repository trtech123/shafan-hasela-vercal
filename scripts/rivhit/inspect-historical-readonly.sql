-- Use only with CLI --read-only. No customer, card or document URL fields.
SELECT s.receipt_number, s.sale_date, s.method, s.total,
  (p.id IS NOT NULL) AS has_payment_row,
  p.operation AS payment_operation, p.status AS payment_status,
  (p.verified_at IS NOT NULL) AS provider_verified,
  d.state AS payper_state, (d.document_number IS NOT NULL) AS has_official_number
FROM public.sales s
LEFT JOIN public.payment_transactions p ON p.id=s.payment_transaction_id
LEFT JOIN public.payper_document_ledger d ON d.sale_id=s.id
WHERE s.receipt_number IN ('RCP-1039','RCP-1043')
ORDER BY s.receipt_number;
