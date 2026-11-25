-- Read-only, admin-only financial report. No financial rows or customer classifications are changed.
-- Order amounts use activity_date and current cancellation status. Cash flow uses its own event date.
-- Adjustments close at updated_at; future payments use their frozen checkout site when available.
-- A verified payment transaction owns its sale; accounting documents are never payment sources.
BEGIN;

CREATE FUNCTION public.get_revenue_report(
  p_from date, p_to date, p_site text DEFAULT NULL, p_customer_type text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR coalesce(auth.role(), '') <> 'authenticated' OR NOT public.is_admin()
  THEN RAISE EXCEPTION 'revenue_report_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 3660
  THEN RAISE EXCEPTION 'revenue_report_invalid_range' USING ERRCODE = '22023'; END IF;
  IF p_customer_type IS NOT NULL AND p_customer_type NOT IN
    ('חינוכית','גפ״ן','סוכן/מפיק','חברה','לקוח פרטי','__unknown__')
  THEN RAISE EXCEPTION 'revenue_report_invalid_type' USING ERRCODE = '22023'; END IF;

  WITH order_events AS (
    SELECT o.activity_date AS event_date, o.site, cs.customer_type,
      CASE WHEN o.status = 'בוטל' THEN 'cancelled' ELSE 'order' END AS kind,
      NULL::text AS method, o.total_price AS amount
    FROM public.orders o
    LEFT JOIN public.customer_snapshots cs ON cs.id = o.customer_snapshot_id
    WHERE o.activity_date BETWEEN p_from AND p_to AND o.total_price IS NOT NULL
  ), transaction_events AS (
    SELECT CASE
        WHEN t.operation IN ('refund','void')
          THEN (t.updated_at AT TIME ZONE 'Asia/Jerusalem')::date
        WHEN t.provider IN ('manual_cash','manual_check')
          THEN coalesce(s.sale_date,(t.updated_at AT TIME ZONE 'Asia/Jerusalem')::date)
        ELSE (t.verified_at AT TIME ZONE 'Asia/Jerusalem')::date
      END AS event_date,
      CASE WHEN t.operation IN ('refund','void')
        THEN coalesce(nullif(parent.checkout_snapshot->>'site',''),o.site)
        ELSE coalesce(nullif(t.checkout_snapshot->>'site',''),o.site) END AS site,
      cs.customer_type,
      CASE WHEN t.operation = 'payment' THEN 'receipt'
        WHEN t.operation = 'refund' THEN 'refund' ELSE 'void' END AS kind,
      CASE WHEN t.provider = 'manual_cash' THEN 'מזומן'
        WHEN t.provider = 'manual_check' THEN 'צ׳ק'
        ELSE 'Pelecard' END AS method,
      t.amount
    FROM public.payment_transactions t
    LEFT JOIN public.payment_transactions parent ON parent.id = t.parent_transaction_id
    LEFT JOIN public.sales s ON s.id = t.sale_id
    LEFT JOIN public.sales parent_sale ON parent_sale.id = parent.sale_id
    LEFT JOIN public.orders o ON o.id = COALESCE(t.order_id, parent.order_id,
      s.order_id, parent_sale.order_id)
    LEFT JOIN public.customer_snapshots cs ON cs.id = o.customer_snapshot_id
    WHERE t.currency = 'ILS' AND (
      (t.operation = 'payment' AND t.status = 'succeeded' AND
        (t.provider IN ('manual_cash','manual_check') OR t.verified_at IS NOT NULL)) OR
      (t.operation = 'refund' AND t.status = 'refunded') OR
      (t.operation = 'void' AND t.status = 'voided'))
  ), legacy_sale_events AS (
    SELECT s.sale_date AS event_date, o.site, cs.customer_type,
      'receipt'::text AS kind, s.method, s.total AS amount
    FROM public.sales s
    LEFT JOIN public.orders o ON o.id = s.order_id
    LEFT JOIN public.customer_snapshots cs ON cs.id = o.customer_snapshot_id
    WHERE s.sale_date BETWEEN p_from AND p_to
      AND s.method IN ('מזומן', 'צ''ק') AND s.payment_transaction_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.payment_transactions t WHERE t.sale_id = s.id)
    UNION ALL
    SELECT s.sale_date, o.site, cs.customer_type, 'receipt'::text,
      line.value->>'method', (line.value->>'amount')::numeric
    FROM public.sales s
    CROSS JOIN LATERAL jsonb_array_elements(CASE
      WHEN jsonb_typeof(s.payment_details->'lines') = 'array'
      THEN s.payment_details->'lines' ELSE '[]'::jsonb END) AS line(value)
    LEFT JOIN public.orders o ON o.id = s.order_id
    LEFT JOIN public.customer_snapshots cs ON cs.id = o.customer_snapshot_id
    WHERE s.sale_date BETWEEN p_from AND p_to AND s.method = 'מפוצל'
      AND s.payment_transaction_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.payment_transactions t WHERE t.sale_id = s.id)
      AND line.value->>'method' IN ('מזומן','צ''ק')
      AND CASE WHEN jsonb_typeof(line.value->'amount') = 'number'
        THEN (line.value->>'amount')::numeric > 0 ELSE false END
  ), events AS (
    SELECT * FROM order_events UNION ALL
    SELECT * FROM transaction_events WHERE event_date BETWEEN p_from AND p_to UNION ALL
    SELECT * FROM legacy_sale_events
  ), grouped AS (
    SELECT event_date, site, customer_type, kind, method,
      round(sum(amount) * 100)::bigint AS amount_minor, count(*)::integer AS event_count
    FROM events
    WHERE (p_site IS NULL OR (p_site = '__unknown__' AND site IS NULL) OR site = p_site)
      AND (p_customer_type IS NULL OR
        (p_customer_type = '__unknown__' AND customer_type IS NULL) OR
        customer_type = p_customer_type)
    GROUP BY event_date, site, customer_type, kind, method
  )
  SELECT jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
    'eventDate', event_date, 'site', site, 'customerType', customer_type,
    'kind', kind, 'method', method, 'amountMinor', amount_minor,
    'eventCount', event_count
  ) ORDER BY event_date, site, customer_type, kind, method), '[]'::jsonb))
  INTO v_result FROM grouped;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_revenue_report(date,date,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_report(date,date,text,text) TO authenticated;

COMMIT;
