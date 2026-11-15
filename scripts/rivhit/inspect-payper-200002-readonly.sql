-- Use only with CLI --read-only. Do not fetch the signed document URL or customer fields.
SELECT d.document_number, d.state AS payper_state,
  p.operation, p.status AS payment_status,
  (p.verified_at IS NOT NULL) AS provider_verified,
  p.amount AS payment_amount, p.currency,
  s.receipt_number, s.total AS sale_amount, s.sale_date, s.method AS sale_method,
  (d.payment_id=p.id AND d.sale_id=s.id AND p.sale_id=s.id) AS exact_linkage
FROM public.payper_document_ledger d
JOIN public.payment_transactions p ON p.id=d.payment_id
JOIN public.sales s ON s.id=d.sale_id
WHERE d.document_number='200002';
