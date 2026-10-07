-- Read-only administrator payment view. No gate, existing row, provider or ACL changes to existing functions.
BEGIN;
CREATE FUNCTION public.get_pelecard_order_payment_ui(p_order_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN
  RAISE EXCEPTION 'payment_admin_required' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object(
  'order_id',o.id,'order_number',o.order_number,'amount',o.total_price,
  'payment_status',o.payment_status,'order_status',o.status,
  'payment_id',p.id,'payment_state',p.status,'payment_amount',p.amount,'payment_currency',p.currency,'sale_id',p.sale_id,
  'provider_session_id',p.provider_session_id,'provider_redirect_url',p.provider_redirect_url,
  'controlled',coalesce(c.order_id=o.id AND (p.id=c.payment_id OR (p.id IS NULL AND c.payment_id IS NULL)),false),
  'accounting_held',coalesce(public.is_pelecard_controlled_live_accounting_held(p.id::text),false),
  'init_enabled',coalesce(c.enabled AND p.id IS NULL AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id=o.id OR s.linked_order_info->>'order_number'=o.order_number),false)
 ) INTO result FROM public.orders o
 LEFT JOIN LATERAL (
  SELECT pt.id,pt.status,pt.amount,pt.currency,pt.sale_id,pt.provider_session_id,pt.provider_redirect_url
  FROM public.payment_transactions pt WHERE pt.order_id=o.id AND pt.provider='pelecard' AND pt.operation='payment'
  ORDER BY pt.created_at DESC,pt.id DESC LIMIT 1
 ) p ON true
 LEFT JOIN public.pelecard_controlled_live_control c ON c.order_id=o.id
 WHERE o.id=p_order_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_pelecard_order_payment_ui(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pelecard_order_payment_ui(uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.get_pelecard_order_payment_ui(uuid,uuid) IS 'Read-only admin order/payment view for same-session UI resume. No credentials, card data or confirmation key; no provider calls or business writes.';
NOTIFY pgrst,'reload schema';
COMMIT;
