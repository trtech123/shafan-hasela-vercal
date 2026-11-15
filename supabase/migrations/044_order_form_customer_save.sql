-- Additive order form transaction. Depends on 041; does not change payment/accounting behavior.
BEGIN;
CREATE TABLE public.order_form_save_requests (
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 request_id uuid NOT NULL,
 request_data jsonb NOT NULL,
 order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE public.order_form_save_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_form_save_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.order_form_save_requests TO authenticated;
CREATE POLICY order_form_requests_read ON public.order_form_save_requests FOR SELECT TO authenticated
 USING(actor_id=auth.uid() AND (public.is_admin_or_ops() OR public.is_cashier()));
CREATE POLICY order_form_requests_insert ON public.order_form_save_requests FOR INSERT TO authenticated
 WITH CHECK(actor_id=auth.uid() AND (public.is_admin_or_ops() OR public.is_cashier()));

CREATE FUNCTION public.save_order_form(p_request_id uuid,p_order_id uuid,p_data jsonb,p_customer_id uuid,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
 o public.orders; prior public.order_form_save_requests; request jsonb; fields text; values_sql text;
 allowed text[]:=ARRAY['client_name','client_phone','client_email','organization','activity_id','instructor_id','quote_id',
 'activity_date','start_time','end_time','site','num_participants','price_per_person','total_price','status','payment_status',
 'notes','internal_notes','billing_institution_name','billing_signer_name','billing_signer_id','billing_signer_role',
 'billing_signer_phone','billing_company_id','billing_accounting_email'];
 frozen text[]:=ARRAY['client_name','client_phone','client_email','organization','billing_institution_name','billing_company_id','billing_accounting_email'];
BEGIN
 IF auth.uid() IS NULL OR NOT(public.is_admin_or_ops() OR public.is_cashier()) THEN RAISE EXCEPTION 'order_access_denied' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR p_data='{}'::jsonb
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT k=ANY(allowed)) THEN RAISE EXCEPTION 'invalid_order_fields' USING ERRCODE='22023'; END IF;
 request:=jsonb_build_object('order_id',p_order_id,'data',p_data,'customer_id',p_customer_id,'expected_version',p_expected_version);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||p_request_id::text,44));
 SELECT * INTO prior FROM public.order_form_save_requests WHERE actor_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.request_data IS DISTINCT FROM request THEN RAISE EXCEPTION 'order_save_request_conflict' USING ERRCODE='40001'; END IF;
  SELECT * INTO o FROM public.orders WHERE id=prior.order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  RETURN to_jsonb(o);
 END IF;
 IF p_order_id IS NOT NULL THEN
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF p_expected_version IS NULL OR o.customer_record_version<>p_expected_version THEN RAISE EXCEPTION 'customer_version_conflict' USING ERRCODE='40001'; END IF;
  -- Evaluate eligibility on the original order, before any status edits.
  IF p_customer_id IS NOT NULL THEN
   PERFORM public.link_order_customer(o.id,p_customer_id,p_expected_version);
   p_data:=p_data-frozen;
  END IF;
  IF p_data<>'{}'::jsonb THEN
   SELECT string_agg(format('%I = input.%I',k,k),',') INTO fields FROM jsonb_object_keys(p_data) k;
   EXECUTE format('UPDATE public.orders target SET %s FROM jsonb_populate_record(NULL::public.orders,$1) input WHERE target.id=$2 RETURNING target.*',fields) INTO o USING p_data,p_order_id;
  ELSE
   SELECT * INTO o FROM public.orders WHERE id=p_order_id;
  END IF;
 ELSE
  IF p_expected_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'customer_version_conflict' USING ERRCODE='40001'; END IF;
  -- Only supplied columns are inserted, preserving database defaults and number generation.
  SELECT string_agg(format('%I',k),','),string_agg(format('input.%I',k),',') INTO fields,values_sql FROM jsonb_object_keys(p_data) k;
  EXECUTE format('INSERT INTO public.orders (%s) SELECT %s FROM jsonb_populate_record(NULL::public.orders,$1) input RETURNING *',fields,values_sql) INTO o USING p_data;
  IF p_customer_id IS NOT NULL THEN
   PERFORM public.link_order_customer(o.id,p_customer_id,0);
   SELECT * INTO o FROM public.orders WHERE id=o.id;
  END IF;
 END IF;
 IF o.id IS NULL THEN RAISE EXCEPTION 'order_access_denied' USING ERRCODE='42501'; END IF;
 INSERT INTO public.order_form_save_requests(actor_id,request_id,request_data,order_id) VALUES(auth.uid(),p_request_id,request,o.id);
 RETURN to_jsonb(o);
END $$;
REVOKE ALL ON FUNCTION public.save_order_form(uuid,uuid,jsonb,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_order_form(uuid,uuid,jsonb,uuid,integer) TO authenticated;
COMMIT;
