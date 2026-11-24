-- Read-only comparison to the same verified payment facts used by the cash
-- register report. A late Payper document remains visible as a difference.
BEGIN;
CREATE FUNCTION public.rivhit_daily_reconciliation(p_payment_day date)
RETURNS TABLE (payment_day date,site text,payment_method text,
  completed_count bigint,cash_register_gross numeric,
  refund_count bigint,refund_amount numeric,cash_register_net numeric,
  finalized_document_count bigint,finalized_document_gross numeric,
  batched_document_count bigint,batched_document_gross numeric,
  verified_document_count bigint,verified_document_gross numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles u
    WHERE u.id=auth.uid() AND u.role::text='admin') THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE='42501'; END IF;
  IF p_payment_day IS NULL OR p_payment_day NOT BETWEEN DATE '2020-01-01'
    AND DATE '2100-12-31' THEN
    RAISE EXCEPTION 'report_filter_invalid' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  WITH facts AS (
    SELECT p.id,p.provider,p.amount,
      coalesce(nullif(p.checkout_snapshot->>'site',''),'לא ידוע') AS saved_site,
      s.id AS source_id,s.source_facts->>'amount' AS source_amount,
      member.batch_id,e.status AS journal_status
    FROM public.payment_transactions p
    JOIN public.rivhit_journal_control c ON c.singleton
    LEFT JOIN public.rivhit_journal_sources s ON s.payment_id=p.id
    LEFT JOIN public.rivhit_daily_journal_members member ON member.source_id=s.id
    LEFT JOIN public.rivhit_journal_entries e ON e.batch_id=member.batch_id
    WHERE p.operation='payment' AND p.status='succeeded' AND p.sale_id IS NOT NULL
      AND p.currency='ILS' AND c.cutover_at IS NOT NULL AND p.created_at>=c.cutover_at
      AND (coalesce(p.verified_at,p.updated_at) AT TIME ZONE 'Asia/Jerusalem')::date=p_payment_day
  ), paid AS (
  SELECT f.saved_site,f.provider,count(*)::bigint AS completed_count,
    sum(f.amount) AS gross,
    count(f.source_id)::bigint,
    coalesce(sum(f.source_amount::numeric) FILTER
      (WHERE f.source_id IS NOT NULL),0) AS documented_gross,
    count(f.batch_id)::bigint AS batched_count,
    coalesce(sum(f.source_amount::numeric) FILTER
      (WHERE f.batch_id IS NOT NULL),0) AS batched_gross,
    count(*) FILTER (WHERE f.journal_status='verified')::bigint AS verified_count,
    coalesce(sum(f.source_amount::numeric) FILTER
      (WHERE f.journal_status='verified'),0) AS verified_gross
  FROM facts f GROUP BY f.saved_site,f.provider
  ), refunds AS (
    SELECT coalesce(nullif(parent.checkout_snapshot->>'site',''),'לא ידוע') AS saved_site,
      parent.provider,count(*)::bigint AS refund_count,sum(refund.amount) AS refund_amount
    FROM public.payment_transactions refund
    JOIN public.payment_transactions parent ON parent.id=refund.parent_transaction_id
    JOIN public.rivhit_journal_control c ON c.singleton
    WHERE refund.operation='refund' AND refund.status='refunded'
      AND parent.operation='payment' AND parent.status='succeeded'
      AND refund.currency='ILS' AND parent.currency='ILS'
      AND parent.sale_id IS NOT NULL AND c.cutover_at IS NOT NULL
      AND refund.created_at>=c.cutover_at
      AND (refund.updated_at AT TIME ZONE 'Asia/Jerusalem')::date=p_payment_day
    GROUP BY coalesce(nullif(parent.checkout_snapshot->>'site',''),'לא ידוע'),parent.provider
  )
  SELECT p_payment_day,coalesce(p.saved_site,r.saved_site),coalesce(p.provider,r.provider),
    coalesce(p.completed_count,0),coalesce(p.gross,0),
    coalesce(r.refund_count,0),coalesce(r.refund_amount,0),
    coalesce(p.gross,0)-coalesce(r.refund_amount,0),
    coalesce(p.count,0),coalesce(p.documented_gross,0),
    coalesce(p.batched_count,0),coalesce(p.batched_gross,0),
    coalesce(p.verified_count,0),coalesce(p.verified_gross,0)
  FROM paid p FULL JOIN refunds r
    ON r.saved_site=p.saved_site AND r.provider=p.provider
  ORDER BY coalesce(p.saved_site,r.saved_site),coalesce(p.provider,r.provider);
END; $$;
REVOKE ALL ON FUNCTION public.rivhit_daily_reconciliation(date)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rivhit_daily_reconciliation(date) TO authenticated;

-- Cron reads only counts. An overdue result is operational evidence, never an
-- instruction to resend a reserved or uncertain provider request.
CREATE FUNCTION public.rivhit_journal_overdue_counts()
RETURNS TABLE (unbatched bigint,unverified bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT
    (SELECT count(*) FROM public.rivhit_journal_sources s
      JOIN public.rivhit_journal_control c ON c.singleton
      WHERE c.cutover_at IS NOT NULL AND s.captured_at>=c.cutover_at
        AND s.state='mapping_required'
        AND (s.captured_at AT TIME ZONE 'Asia/Jerusalem')::date <
          (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date),
    (SELECT count(*) FROM public.rivhit_daily_journal_batches b
      JOIN public.rivhit_journal_entries e ON e.batch_id=b.id
      WHERE b.posting_day < (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date
        AND e.status<>'verified');
END; $$;
REVOKE ALL ON FUNCTION public.rivhit_journal_overdue_counts()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rivhit_journal_overdue_counts() TO service_role;
COMMIT;
