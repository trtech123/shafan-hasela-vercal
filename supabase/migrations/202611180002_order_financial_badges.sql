-- Read-only order collection summaries for list and schedule views.
-- Payment, refund, void and physical-intent rows remain the source of truth.
BEGIN;

CREATE FUNCTION public.get_order_financial_badges(p_order_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'authenticated' OR auth.uid() IS NULL OR
    NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid())
  THEN RAISE EXCEPTION 'order_financial_badges_forbidden' USING ERRCODE='42501'; END IF;
  IF p_order_ids IS NULL OR cardinality(p_order_ids)>100
  THEN RAISE EXCEPTION 'order_financial_badges_invalid' USING ERRCODE='23514'; END IF;

  WITH amounts AS (
    SELECT o.id, o.order_number, o.total_price, o.payment_status, o.status,
      o.archived_at,
      coalesce(p.paid,0)+coalesce(s.paid,0) AS paid,
      coalesce(p.adjusted,false) AS adjusted,
      coalesce(p.unresolved,false) OR
        EXISTS(SELECT 1 FROM public.physical_payment_intents i
          JOIN public.payment_transactions t ON t.id=i.payment_id
          WHERE t.order_id=o.id AND i.state IN
            ('reserved','dispatching','pending','uncertain','approved')) OR
        EXISTS(SELECT 1 FROM public.sales orphan_sale
          WHERE orphan_sale.order_id IS NULL AND
            orphan_sale.linked_order_info->>'order_number'=o.order_number) OR
        EXISTS(SELECT 1 FROM public.payment_transactions orphan_payment
          WHERE orphan_payment.order_id IS NULL AND
            orphan_payment.checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
        AS unresolved
    FROM public.orders o
    JOIN (SELECT DISTINCT unnest(p_order_ids) AS id) requested ON requested.id=o.id
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(CASE
        WHEN t.operation='refund' AND t.status='refunded' THEN -t.amount
        WHEN t.operation='void' AND t.status='voided' THEN -t.amount
        WHEN t.operation='payment' AND t.status='succeeded' THEN t.amount
        ELSE 0 END),0) AS paid,
        coalesce(bool_or(t.operation IN ('refund','void') AND
          t.status IN ('refunded','voided')),false) AS adjusted,
        coalesce(bool_or(t.status IN
          ('initiated','pending_provider','timed_out','refund_pending','void_pending')),false)
          AS unresolved
      FROM public.payment_transactions t WHERE t.order_id=o.id
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(s.total),0) AS paid FROM public.sales s
      WHERE s.order_id=o.id AND s.payment_transaction_id IS NULL
        AND s.method IN ('צ''ק','מזומן')
    ) s ON true
    WHERE public.is_admin_or_ops() OR public.is_cashier() OR
      o.instructor_id=public.get_my_instructor_id()
  ), classified AS (
    SELECT id, (total_price*100)::bigint AS total_minor,
      (paid*100)::bigint AS paid_minor,
      ((total_price-paid)*100)::bigint AS balance_minor,
      CASE
        WHEN archived_at IS NOT NULL OR status='בוטל' OR total_price IS NULL OR
          total_price<=0 OR total_price*100<>trunc(total_price*100) THEN 'unavailable'
        WHEN unresolved OR paid<0 OR paid>total_price OR
          (NOT adjusted AND (
            ((payment_status IS NULL OR payment_status NOT IN ('לא שולם','שולם חלקית'))
              AND paid<total_price) OR
            (payment_status='שולם חלקית' AND paid<=0)))
          THEN 'review'
        WHEN paid=total_price THEN 'paid'
        WHEN paid>0 THEN 'partial'
        ELSE 'unpaid'
      END AS state
    FROM amounts
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'orderId',id,'state',state,'totalMinor',total_minor,
    'paidMinor',paid_minor,'balanceMinor',balance_minor) ORDER BY id),'[]'::jsonb)
    INTO result FROM classified;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_order_financial_badges(uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_order_financial_badges(uuid[]) TO authenticated;

COMMIT;
