-- Each checkout is keyed by its own immutable request UUID. Existing unsettled
-- attempts remain untouched and cannot be reused for a distinct purchase.
BEGIN;
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.reserve_pos_pelecard(uuid,uuid,jsonb,jsonb,jsonb)') IS NULL
    OR position('pos_payment_in_progress' IN
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure('public.reserve_pos_pelecard(uuid,uuid,jsonb,jsonb,jsonb)'))) = 0
    OR pg_catalog.to_regclass('public.pos_pelecard_intents') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
      WHERE oid=pg_catalog.to_regprocedure('public.reserve_pos_pelecard(uuid,uuid,jsonb,jsonb,jsonb)')
        AND pg_catalog.md5(pg_catalog.regexp_replace(prosrc,'[[:space:]]','','g'))=
          '9606810c26974a5c0d8727c60b4355a5')
  THEN RAISE EXCEPTION 'unexpected_pos_reservation_baseline' USING ERRCODE='23514'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.reserve_pos_pelecard(
  p_actor_id uuid, p_request_key uuid, p_lines jsonb, p_discount jsonb, p_billing jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  role_name text; line jsonb; catalog_id uuid; kind text; qty integer;
  item_name text; unit_price numeric; cart_vat boolean:=true;
  subtotal numeric:=0; total numeric; deduction numeric:=0;
  frozen jsonb:='[]'::jsonb; intent public.pos_pelecard_intents%ROWTYPE;
  payment_id uuid;
  billing_kind text; billing_name text; billing_identity text; billing_email text;
  discount_snapshot jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT role::text INTO role_name FROM public.profiles WHERE id=p_actor_id FOR UPDATE;
  IF role_name IS NULL OR role_name NOT IN ('admin','cashier') OR p_request_key IS NULL THEN RAISE EXCEPTION 'pos_payment_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO intent FROM public.pos_pelecard_intents WHERE request_key=p_request_key;
  IF FOUND THEN
    IF intent.created_by IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'request_key_conflict' USING ERRCODE='23514'; END IF;
    RETURN pg_catalog.jsonb_build_object('paymentId',intent.payment_id,'created',false,'amountMinor',(intent.amount*100)::integer);
  END IF;
  IF pg_catalog.jsonb_typeof(p_lines)<>'array' OR pg_catalog.jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'cart_invalid' USING ERRCODE='23514'; END IF;
  FOR line IN SELECT value FROM pg_catalog.jsonb_array_elements(p_lines) LOOP
    IF pg_catalog.jsonb_typeof(line)<>'object' OR
      (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys(line) key)
       IS DISTINCT FROM ARRAY['id','kind','qty']::text[] OR
      line->>'id' !~ '^[0-9a-fA-F-]{36}$' OR line->>'kind' IS NULL OR
      line->>'kind' NOT IN ('product','service') OR
      pg_catalog.jsonb_typeof(line->'qty')<>'number' OR line->>'qty' !~ '^[0-9]{1,4}$'
    THEN RAISE EXCEPTION 'cart_line_invalid' USING ERRCODE='23514'; END IF;
    catalog_id:=(line->>'id')::uuid; kind:=line->>'kind'; qty:=(line->>'qty')::integer;
    IF qty NOT BETWEEN 1 AND 1000 OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(frozen) prior
      WHERE prior.value->>'id'=catalog_id::text)
    THEN RAISE EXCEPTION 'cart_line_invalid' USING ERRCODE='23514'; END IF;
    IF kind='product' THEN
      SELECT nullif(pg_catalog.btrim(name),''),price INTO item_name,unit_price
      FROM public.products WHERE id=catalog_id AND status='פעיל' FOR SHARE;
    ELSE
      SELECT nullif(pg_catalog.btrim(name),''),price_per_person INTO item_name,unit_price
      FROM public.activities WHERE id=catalog_id AND status='פעיל' FOR SHARE;
    END IF;
    IF item_name IS NULL OR pg_catalog.length(item_name)>200 OR unit_price IS NULL OR unit_price<=0
      OR unit_price*100<>pg_catalog.trunc(unit_price*100)
    THEN RAISE EXCEPTION 'catalog_item_unavailable' USING ERRCODE='23514'; END IF;
    subtotal:=subtotal+unit_price*qty;
    IF subtotal*100>2147483647 THEN RAISE EXCEPTION 'cart_amount_invalid' USING ERRCODE='23514'; END IF;
    frozen:=frozen||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id',catalog_id::text,'name',item_name,'qty',qty,'customPrice',unit_price));
  END LOOP;
  IF p_discount IS NOT NULL AND p_discount<>'null'::jsonb THEN
    IF role_name<>'admin' OR pg_catalog.jsonb_typeof(p_discount)<>'object' OR
      (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys(p_discount) key)
       IS DISTINCT FROM ARRAY['mode','type','value']::text[] OR
      p_discount->>'type' IS NULL OR p_discount->>'type' NOT IN ('הנחת עובד','הנחת נכה','הנחה כללית') OR
      p_discount->>'mode' IS NULL OR p_discount->>'mode' NOT IN ('fixed','percentage') OR
      pg_catalog.jsonb_typeof(p_discount->'value')<>'number' OR
      p_discount->>'value' !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$'
    THEN RAISE EXCEPTION 'discount_invalid' USING ERRCODE='23514'; END IF;
    IF p_discount->>'mode'='fixed' THEN deduction:=(p_discount->>'value')::numeric;
    ELSE
      IF (p_discount->>'value')::numeric>100 THEN RAISE EXCEPTION 'discount_invalid' USING ERRCODE='23514'; END IF;
      deduction:=pg_catalog.round(subtotal*(p_discount->>'value')::numeric/100,2);
    END IF;
    IF deduction<=0 THEN RAISE EXCEPTION 'discount_invalid' USING ERRCODE='23514'; END IF;
    discount_snapshot:=p_discount||pg_catalog.jsonb_build_object('original_total',subtotal,'final_total',subtotal-deduction);
  END IF;
  total:=subtotal-deduction;
  IF total<=0 OR total*100>2147483647 THEN RAISE EXCEPTION 'cart_amount_invalid' USING ERRCODE='23514'; END IF;
  billing_kind:=nullif(p_billing->>'kind','');
  IF billing_kind NOT IN ('person','organization') THEN billing_kind:=NULL; END IF;
  billing_name:=nullif(pg_catalog.btrim(p_billing->>'name'),'');
  IF pg_catalog.length(billing_name)>200 THEN billing_name:=NULL; END IF;
  billing_identity:=nullif(pg_catalog.btrim(p_billing->>'identity'),'');
  IF billing_identity !~ '^[0-9]{9}$' OR billing_identity='000000000' OR
    (billing_kind='person' AND NOT public.payper_valid_person_identity(billing_identity))
  THEN billing_identity:=NULL; END IF;
  billing_email:=nullif(pg_catalog.btrim(p_billing->>'email'),'');
  IF pg_catalog.length(billing_email)>320 OR billing_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN billing_email:=NULL; END IF;
  payment_id:=pg_catalog.gen_random_uuid();
  INSERT INTO public.payment_transactions(id,provider,operation,order_id,amount,currency,status,
    idempotency_key,checkout_snapshot,created_by)
  VALUES(payment_id,'pelecard','payment',NULL,total,'ILS','initiated',
    'pos-'||payment_id::text,pg_catalog.jsonb_build_object('schema_version',1,'items',frozen,
      'discount',discount_snapshot,'linked_order_info',NULL,'sale_date',
      (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date::text),p_actor_id);
  INSERT INTO public.pos_pelecard_intents(payment_id,request_key,created_by,source_lines,amount,vat_applicable,
    billing_kind,billing_name,billing_identity,billing_email)
  VALUES(payment_id,p_request_key,p_actor_id,p_lines,total,cart_vat,
    billing_kind,billing_name,billing_identity,billing_email);
  INSERT INTO public.payper_payment_billing_snapshots(payment_id,order_id,customer_kind,
    billing_name,billing_identity,billing_email,vat_applicable)
  VALUES(payment_id,NULL,billing_kind,billing_name,billing_identity,billing_email,cart_vat);
  RETURN pg_catalog.jsonb_build_object('paymentId',payment_id,'created',true,'amountMinor',(total*100)::integer);
END $$;
COMMIT;
