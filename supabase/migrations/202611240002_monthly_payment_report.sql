-- Admin-only, read-only operational summary. This is not a fiscal Z report.
BEGIN;
CREATE FUNCTION public.monthly_payment_report(
  p_year integer,p_month integer,p_site text DEFAULT NULL,p_register text DEFAULT NULL
) RETURNS TABLE (
  day date,site text,register_number text,payment_method text,
  completed_count bigint,gross_amount numeric,refund_count bigint,refund_amount numeric,
  issued_document_count bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE month_start date; month_end date;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles u
    WHERE u.id=auth.uid() AND u.role::text='admin') THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE='42501'; END IF;
  IF p_year NOT BETWEEN 2020 AND 2100 OR p_month NOT BETWEEN 1 AND 12
    OR (p_site IS NOT NULL AND p_site NOT IN
      ('עכו','טבריה','נוף הגליל','שטח','פודטראק','קפה אקסטרים'))
    OR (p_register IS NOT NULL AND p_register NOT IN ('003','004','005','006',''))
  THEN RAISE EXCEPTION 'report_filter_invalid' USING ERRCODE='22023'; END IF;
  month_start:=pg_catalog.make_date(p_year,p_month,1);
  month_end:=(month_start + INTERVAL '1 month')::date;
  RETURN QUERY
  WITH facts AS (
    SELECT p.id,p.operation,p.amount,
      CASE WHEN p.operation='refund' THEN p.updated_at
        ELSE coalesce(p.verified_at,p.updated_at) END AS completed_at,
      CASE WHEN p.operation='refund' THEN parent.provider ELSE p.provider END AS provider,
      CASE WHEN p.operation='refund' THEN parent.checkout_snapshot->>'site'
        ELSE p.checkout_snapshot->>'site' END AS saved_site,
      CASE WHEN p.operation='refund' THEN parent.id ELSE p.id END AS original_payment_id
    FROM public.payment_transactions p
    LEFT JOIN public.payment_transactions parent ON parent.id=p.parent_transaction_id
    WHERE (p.operation='payment' AND p.status='succeeded' AND p.sale_id IS NOT NULL
        AND p.currency='ILS')
      OR (p.operation='refund' AND p.status='refunded' AND parent.status='succeeded'
        AND parent.sale_id IS NOT NULL AND p.currency='ILS' AND parent.currency='ILS')
  ), scoped AS (
    SELECT (f.completed_at AT TIME ZONE 'Asia/Jerusalem')::date AS local_day,
      coalesce(nullif(f.saved_site,''),'לא ידוע') AS saved_site,
      coalesce(i.register_number,'') AS register_id,
      CASE f.provider WHEN 'pelecard' THEN 'אשראי'
        WHEN 'manual_cash' THEN 'מזומן' WHEN 'manual_check' THEN 'צ׳ק'
        ELSE 'אחר' END AS method,
      f.operation,f.amount,
      CASE WHEN f.operation='payment' THEN (SELECT count(*)
        FROM public.payper_document_ledger l
        WHERE l.payment_id=f.id AND l.state='succeeded') ELSE 0 END AS issued_document_count
    FROM facts f LEFT JOIN public.physical_payment_intents i
      ON i.payment_id=f.original_payment_id
    WHERE f.completed_at >= (month_start::timestamp AT TIME ZONE 'Asia/Jerusalem')
      AND f.completed_at < (month_end::timestamp AT TIME ZONE 'Asia/Jerusalem')
  )
  SELECT s.local_day,s.saved_site,s.register_id,s.method,
    count(*) FILTER (WHERE s.operation='payment')::bigint,
    coalesce(sum(s.amount) FILTER (WHERE s.operation='payment'),0),
    count(*) FILTER (WHERE s.operation='refund')::bigint,
    coalesce(sum(s.amount) FILTER (WHERE s.operation='refund'),0),
    sum(s.issued_document_count)::bigint
  FROM scoped s
  WHERE (p_site IS NULL OR s.saved_site=p_site)
    AND (p_register IS NULL OR s.register_id=p_register)
  GROUP BY s.local_day,s.saved_site,s.register_id,s.method
  ORDER BY s.local_day,s.saved_site,s.register_id,s.method;
END $$;
REVOKE ALL ON FUNCTION public.monthly_payment_report(integer,integer,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.monthly_payment_report(integer,integer,text,text)
  TO authenticated;

-- Only immutable customer snapshots count as identified payers. Guest and
-- historical payments stay explicitly unidentifiable in the report.
CREATE FUNCTION public.monthly_identified_payers(
  p_year integer,p_month integer,p_site text DEFAULT NULL,p_register text DEFAULT NULL
) RETURNS TABLE (identified_customers bigint,unidentified_payments bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE month_start date; month_end date;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles u
    WHERE u.id=auth.uid() AND u.role::text='admin') THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE='42501'; END IF;
  IF p_year NOT BETWEEN 2020 AND 2100 OR p_month NOT BETWEEN 1 AND 12
    OR (p_site IS NOT NULL AND p_site NOT IN
      ('עכו','טבריה','נוף הגליל','שטח','פודטראק','קפה אקסטרים'))
    OR (p_register IS NOT NULL AND p_register NOT IN ('003','004','005','006',''))
  THEN RAISE EXCEPTION 'report_filter_invalid' USING ERRCODE='22023'; END IF;
  month_start:=pg_catalog.make_date(p_year,p_month,1);
  month_end:=(month_start + INTERVAL '1 month')::date;
  RETURN QUERY SELECT count(DISTINCT cs.customer_id)::bigint,
    count(*) FILTER (WHERE cs.customer_id IS NULL)::bigint
    FROM public.payment_transactions p
    LEFT JOIN public.payper_payment_billing_snapshots b ON b.payment_id=p.id
    LEFT JOIN public.customer_snapshots cs ON cs.id=b.source_customer_snapshot_id
    LEFT JOIN public.physical_payment_intents i ON i.payment_id=p.id
    WHERE p.operation='payment' AND p.status='succeeded' AND p.sale_id IS NOT NULL
      AND p.currency='ILS'
      AND coalesce(p.verified_at,p.updated_at) >=
        (month_start::timestamp AT TIME ZONE 'Asia/Jerusalem')
      AND coalesce(p.verified_at,p.updated_at) <
        (month_end::timestamp AT TIME ZONE 'Asia/Jerusalem')
      AND (p_site IS NULL OR coalesce(nullif(p.checkout_snapshot->>'site',''),'לא ידוע')=p_site)
      AND (p_register IS NULL OR coalesce(i.register_number,'')=p_register);
END $$;
REVOKE ALL ON FUNCTION public.monthly_identified_payers(integer,integer,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.monthly_identified_payers(integer,integer,text,text)
  TO authenticated;
COMMIT;
