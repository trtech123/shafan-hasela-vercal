-- Allow only administrators and cashiers to use hosted order payment.
-- Requires the Payper billing snapshot migration; dispatch stays disabled.
BEGIN;
CREATE OR REPLACE FUNCTION public.reserve_pelecard_order_payment(
  p_payment_id UUID, p_order_id UUID, p_created_by UUID,
  p_idempotency_key TEXT, p_amount NUMERIC, p_currency TEXT,
  p_checkout_snapshot JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  order_row public.orders%ROWTYPE;
  existing public.payment_transactions%ROWTYPE;
  snapshot JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_created_by
    AND role::text IN ('admin', 'cashier')) THEN
    RAISE EXCEPTION 'order_payment_forbidden' USING ERRCODE = '42501';
  END IF;
  -- One short reservation per order, including different idempotency keys.
  SELECT * INTO order_row FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_payable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO existing FROM public.payment_transactions
    WHERE provider = 'pelecard' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF existing.order_id IS DISTINCT FROM p_order_id
      OR existing.created_by IS DISTINCT FROM p_created_by
      OR existing.amount IS DISTINCT FROM p_amount
      OR existing.currency IS DISTINCT FROM p_currency THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23514';
    END IF;
    RETURN to_jsonb(existing) || jsonb_build_object('created', false);
  END IF;
  IF order_row.payment_status IS DISTINCT FROM 'לא שולם'
    OR order_row.status IN ('שולם', 'בוטל')
    OR order_row.total_price IS NULL OR order_row.total_price <= 0
    OR EXISTS (SELECT 1 FROM public.sales WHERE order_id = p_order_id)
    OR EXISTS (SELECT 1 FROM public.payment_transactions WHERE order_id = p_order_id
      AND operation = 'payment' AND status IN ('succeeded', 'refund_pending', 'refunded', 'void_pending', 'voided')) THEN
    RAISE EXCEPTION 'order_not_payable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_transactions WHERE order_id = p_order_id
    AND operation = 'payment' AND status IN ('initiated', 'pending_provider', 'timed_out')) THEN
    RAISE EXCEPTION 'order_payment_in_progress' USING ERRCODE = '23514';
  END IF;
  -- The browser amount is only an expectation. It never becomes the payable amount.
  IF p_amount IS DISTINCT FROM order_row.total_price OR p_currency IS DISTINCT FROM 'ILS' THEN
    RAISE EXCEPTION 'order_amount_mismatch' USING ERRCODE = '23514';
  END IF;
  snapshot := jsonb_build_object(
    'schema_version', 1,
    'items', jsonb_build_array(jsonb_build_object(
      'id', order_row.id::text, 'name', order_row.order_number,
      'qty', 1, 'customPrice', order_row.total_price)),
    'discount', NULL,
    'linked_order_info', jsonb_build_object(
      'order_number', order_row.order_number, 'client_name', order_row.client_name,
      'client_phone', order_row.client_phone, 'organization', COALESCE(order_row.organization, '')),
    'sale_date', CURRENT_DATE::text);
  RETURN public.reserve_pelecard_payment(p_payment_id, p_order_id, p_created_by,
    p_idempotency_key, order_row.total_price, 'ILS', snapshot);
END;
$$;
CREATE OR REPLACE FUNCTION public.reserve_pelecard_live_order(p_order_id uuid,p_actor_id uuid,p_expected_amount_minor integer,p_previous_payment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; a public.pelecard_live_attempts%ROWTYPE; result jsonb; new_id uuid;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text IN ('admin','cashier')) THEN RAISE EXCEPTION 'payment_admin_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_payable' USING ERRCODE='23514'; END IF;
 IF o.total_price IS NULL OR o.total_price<=0 OR o.total_price*100>2147483647 OR o.total_price*100 IS DISTINCT FROM p_expected_amount_minor::numeric THEN
  RAISE EXCEPTION 'order_amount_mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM public.pelecard_live_attempts WHERE order_id=p_order_id ORDER BY created_at DESC,payment_id DESC LIMIT 1;
 IF FOUND THEN
  IF p_previous_payment_id IS NOT NULL AND p_previous_payment_id<>a.payment_id THEN RAISE EXCEPTION 'stale_payment_attempt' USING ERRCODE='23514'; END IF;
  IF a.closed_unpaid_at IS NULL THEN RETURN jsonb_build_object('id',a.payment_id,'created',false); END IF;
  IF p_previous_payment_id IS DISTINCT FROM a.payment_id THEN RAISE EXCEPTION 'stale_payment_attempt' USING ERRCODE='23514'; END IF;
  IF NOT public.can_replace_pelecard_live(p_order_id,a.payment_id) THEN RAISE EXCEPTION 'order_payment_in_progress' USING ERRCODE='23514'; END IF;
 ELSE
 IF p_previous_payment_id IS NOT NULL THEN RAISE EXCEPTION 'stale_payment_attempt' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.payment_transactions WHERE order_id=p_order_id OR checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
 OR EXISTS(SELECT 1 FROM public.sales WHERE order_id=p_order_id OR linked_order_info->>'order_number'=o.order_number)
 OR EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control WHERE order_id=p_order_id) THEN
  RAISE EXCEPTION 'order_payment_in_progress' USING ERRCODE='23514'; END IF;
 END IF;
 new_id:=pg_catalog.gen_random_uuid();
 INSERT INTO public.pelecard_live_attempts(payment_id,order_id) VALUES(new_id,p_order_id);
 result:=public.reserve_pelecard_order_payment(new_id,p_order_id,p_actor_id,'live-'||new_id::text,o.total_price,'ILS','{}');
 INSERT INTO public.pelecard_live_audit(payment_id,event_type) VALUES(new_id,'reserved');
 RETURN jsonb_build_object('id',new_id,'created',true);
END $$;
CREATE OR REPLACE FUNCTION public.get_pelecard_order_payment_ui(p_order_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text IN ('admin','cashier')) THEN RAISE EXCEPTION 'payment_admin_required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('order_id',o.id,'order_number',o.order_number,'amount',o.total_price,'payment_status',o.payment_status,'order_status',o.status,
 'payment_id',p.id,'payment_state',p.status,'payment_amount',p.amount,'payment_currency',p.currency,'sale_id',p.sale_id,
 'provider_session_id',p.provider_session_id,'provider_redirect_url',p.provider_redirect_url,
 'controlled',coalesce(c.order_id=o.id AND(p.id=c.payment_id OR(p.id IS NULL AND c.payment_id IS NULL)),false),
 'accounting_held',public.is_pelecard_controlled_live_accounting_held(p.id::text),
 'init_enabled',public.can_replace_pelecard_live(o.id,p.id) OR (c.order_id IS NULL AND p.id IS NULL AND o.payment_status='לא שולם' AND o.status NOT IN ('שולם','בוטל') AND o.total_price>0
 AND NOT EXISTS(SELECT 1 FROM public.payment_transactions x WHERE x.order_id=o.id OR x.checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
 AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id=o.id OR s.linked_order_info->>'order_number'=o.order_number)),
 'hosted_expires_at',a.hosted_expires_at,'closed_unpaid_at',a.closed_unpaid_at,
 'hosted_state',CASE WHEN a.hosted_expires_at<=statement_timestamp() THEN 'expired' ELSE coalesce(a.hosted_state,'unknown') END,'last_lookup_status',a.last_lookup_status,'last_transaction_status',a.last_transaction_status,
 'correlation_valid',a.correlation_valid,'can_replace',public.can_replace_pelecard_live(o.id,p.id))
 INTO result FROM public.orders o LEFT JOIN LATERAL(SELECT pt.* FROM public.payment_transactions pt WHERE pt.order_id=o.id AND pt.provider='pelecard' AND pt.operation='payment' ORDER BY coalesce((SELECT la.created_at FROM public.pelecard_live_attempts la WHERE la.payment_id=pt.id),pt.created_at) DESC,pt.id DESC LIMIT 1)p ON true
 LEFT JOIN public.pelecard_live_attempts a ON a.payment_id=p.id LEFT JOIN public.pelecard_controlled_live_control c ON c.order_id=o.id WHERE o.id=p_order_id;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.get_payper_billing_defaults(p_order_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c public.customer_snapshots%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text IN ('admin','cashier'))
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.customer_snapshots WHERE id=o.customer_snapshot_id
  AND order_id=o.id AND customer_id=o.customer_id AND revision=o.customer_record_version;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','person','name','','identity','','email',''); END IF;
 RETURN jsonb_build_object('kind',c.customer_kind,
  'name',coalesce(c.data->>'billing_institution_name',c.data->>'client_name',''),
  'identity',regexp_replace(coalesce(c.data->>'billing_company_id',''),'[[:space:]-]','','g'),
  'email',coalesce(c.data->>'billing_accounting_email',c.data->>'client_email',''));
END $$;
CREATE OR REPLACE FUNCTION public.reserve_pelecard_live_order(
 p_order_id uuid,p_actor_id uuid,p_expected_amount_minor integer,
 p_previous_payment_id uuid,p_billing jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; o public.orders%ROWTYPE; c public.customer_snapshots%ROWTYPE;
 input jsonb; kind text; name text; identity text; email text; vat boolean;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text IN ('admin','cashier'))
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 input:=CASE WHEN jsonb_typeof(p_billing)='object' THEN p_billing ELSE '{}'::jsonb END;
 result:=public.reserve_pelecard_live_order(p_order_id,p_actor_id,p_expected_amount_minor,p_previous_payment_id);
 IF (result->>'created')::boolean IS DISTINCT FROM true THEN RETURN result; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 SELECT * INTO c FROM public.customer_snapshots WHERE id=o.customer_snapshot_id
  AND order_id=o.id AND customer_id=o.customer_id AND revision=o.customer_record_version;
 kind:=coalesce(input->>'kind',c.customer_kind);
 IF kind NOT IN ('person','organization') THEN kind:=NULL; END IF;
 name:=nullif(btrim(input->>'name'),'');
 IF length(name)>200 THEN name:=NULL; END IF;
 identity:=nullif(btrim(input->>'identity'),'');
 IF identity !~ '^[0-9]{9}$' OR identity='000000000'
  OR (kind='person' AND NOT public.payper_valid_person_identity(identity)) THEN identity:=NULL; END IF;
 email:=nullif(btrim(input->>'email'),'');
 IF length(email)>320 OR email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN email:=NULL; END IF;
 vat:=CASE WHEN c.id IS NOT NULL AND jsonb_typeof(c.data->'vat_applicable')='boolean'
  THEN (c.data->>'vat_applicable')::boolean ELSE NULL END;
 INSERT INTO public.payper_payment_billing_snapshots(payment_id,order_id,source_customer_snapshot_id,
  customer_kind,billing_name,billing_identity,billing_email,vat_applicable)
 VALUES((result->>'id')::uuid,p_order_id,c.id,kind,name,identity,email,vat);
 RETURN result;
END $$;
COMMIT;
