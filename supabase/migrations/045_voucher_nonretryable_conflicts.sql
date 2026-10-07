-- Permanent business conflicts must not use serialization_failure (40001).
-- PostgREST retries serialization failures; PT409 returns HTTP 409 immediately.
-- Preserve all locks, immutable snapshots, exact replay and grants. No data changes.
BEGIN;
CREATE OR REPLACE FUNCTION public.create_hakafa_voucher(p_id uuid,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; s public.customer_snapshots; v public.hakafa_vouchers; actor_role text; actor_name text; register_name text;
BEGIN
 SELECT role::text,coalesce(nullif(full_name,''),email,'') INTO actor_role,actor_name FROM public.profiles WHERE id=auth.uid();
 IF auth.uid() IS NULL OR actor_role IS NULL OR actor_role NOT IN ('admin','operations','cashier') THEN RAISE EXCEPTION 'voucher_access_denied' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR NOT(p_data ?& ARRAY['order_id','register_code','customer_snapshot_id','service_description','notes','contact_name','phone','signature'])
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k<>ALL(ARRAY['order_id','register_code','customer_snapshot_id','service_description','notes','contact_name','phone','signature']))
  OR EXISTS(SELECT 1 FROM jsonb_each(p_data) WHERE key<>'signature' AND jsonb_typeof(value)<>'string') THEN RAISE EXCEPTION 'invalid_voucher_data' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,41));
 SELECT * INTO v FROM public.hakafa_vouchers WHERE id=p_id;
 IF FOUND THEN
  IF v.request_data IS DISTINCT FROM p_data OR v.created_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'voucher_idempotency_conflict' USING ERRCODE='PT409'; END IF;
  RETURN to_jsonb(v);
 END IF;
 SELECT * INTO o FROM public.orders WHERE id=(p_data->>'order_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
 IF EXISTS(SELECT 1 FROM public.hakafa_vouchers WHERE order_id=o.id) THEN RAISE EXCEPTION 'order_voucher_exists' USING ERRCODE='PT409'; END IF;
 IF o.order_number='ORD-1039' OR EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control WHERE order_id=o.id) OR o.status IN (U&'\05D1\05D5\05D8\05DC',U&'\05E9\05D5\05DC\05DD') OR o.payment_status IS DISTINCT FROM U&'\05DC\05D0 \05E9\05D5\05DC\05DD'
  OR EXISTS(SELECT 1 FROM public.sales WHERE order_id=o.id OR linked_order_info->>'order_number'=o.order_number)
  OR EXISTS(SELECT 1 FROM public.payment_transactions WHERE order_id=o.id AND status NOT IN ('expired','failed'))
  OR EXISTS(SELECT 1 FROM public.pelecard_live_attempts WHERE order_id=o.id AND closed_unpaid_at IS NULL)
 THEN RAISE EXCEPTION 'unpaid_order_required'; END IF;
 SELECT name INTO register_name FROM public.cash_registers WHERE code=p_data->>'register_code' AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'active_register_required'; END IF;
 SELECT * INTO s FROM public.customer_snapshots WHERE id=o.customer_snapshot_id AND id=(p_data->>'customer_snapshot_id')::uuid AND order_id=o.id;
 IF NOT FOUND OR jsonb_typeof(s.data->'vat_applicable') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'reviewed_customer_snapshot_required'; END IF;
 IF s.customer_kind='organization' AND coalesce(s.data->>'billing_company_id','') !~ '^[0-9]{9}$' THEN RAISE EXCEPTION 'billing_company_id_required'; END IF;
 INSERT INTO public.hakafa_vouchers(id,order_id,order_number,register_code,register_name,customer_id,customer_snapshot_id,customer_version,vat_applicable,
 billing_name,billing_company_id,billing_accounting_email,service_description,notes,contact_name,phone,signature,created_by,creator_name,creator_role,request_data)
 VALUES(p_id,o.id,o.order_number,p_data->>'register_code',register_name,s.customer_id,s.id,s.customer_version,(s.data->>'vat_applicable')::boolean,
 s.data->>'billing_institution_name',s.data->>'billing_company_id',s.data->>'billing_accounting_email',p_data->>'service_description',p_data->>'notes',
 p_data->>'contact_name',p_data->>'phone',p_data->'signature',auth.uid(),actor_name,actor_role,p_data) RETURNING * INTO v;
 RETURN to_jsonb(v);
END $$;
COMMIT;
