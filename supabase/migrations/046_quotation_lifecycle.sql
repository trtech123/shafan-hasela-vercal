-- Quotation-only lifecycle. No payment/accounting calls or historical backfill.
BEGIN;
ALTER TABLE public.quotes
 ADD COLUMN quotation_version integer NOT NULL DEFAULT 0 CHECK(quotation_version>=0),
 ADD COLUMN quotation_revision_id uuid,
 ADD COLUMN customer_id uuid REFERENCES public.customers(id),
 ADD COLUMN customer_version integer,
 ADD COLUMN customer_kind text CHECK(customer_kind IN ('person','organization')),
 ADD COLUMN vat_applicable boolean,
 ADD COLUMN billing_institution_name text,
 ADD COLUMN billing_company_id text,
 ADD COLUMN billing_accounting_email text,
 ADD COLUMN billing_address_line text,
 ADD COLUMN billing_city text,
 ADD COLUMN billing_postal_code text,
 ADD COLUMN billing_country_code text;
CREATE TABLE public.quotation_revisions (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 quote_id uuid NOT NULL REFERENCES public.quotes(id),
 revision integer NOT NULL CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 customer_id uuid REFERENCES public.customers(id),
 customer_version integer CHECK(customer_version>0),
 customer_kind text CHECK(customer_kind IN ('person','organization')),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 captured_by uuid NOT NULL REFERENCES public.profiles(id),
 UNIQUE(quote_id,revision)
);
ALTER TABLE public.quotes ADD CONSTRAINT quotes_quotation_revision_fk FOREIGN KEY(quotation_revision_id) REFERENCES public.quotation_revisions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX quotes_customer_id_idx ON public.quotes(customer_id) WHERE customer_id IS NOT NULL;
CREATE TABLE public.quotation_save_requests (
 actor_id uuid NOT NULL REFERENCES public.profiles(id), request_id uuid NOT NULL,
 request_data jsonb NOT NULL, quote_id uuid NOT NULL REFERENCES public.quotes(id),
 response_data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE public.quotation_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_save_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quotation_revisions,public.quotation_save_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.quotation_revisions TO authenticated,service_role;
CREATE POLICY quotation_revisions_staff_read ON public.quotation_revisions FOR SELECT TO authenticated USING(public.is_admin_or_ops());
CREATE POLICY quotation_revisions_service_read ON public.quotation_revisions FOR SELECT TO service_role USING(true);
CREATE FUNCTION public.reject_quotation_artifact_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'quotation_artifact_immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER quotation_revisions_immutable BEFORE UPDATE OR DELETE ON public.quotation_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_quotation_artifact_mutation();
CREATE TRIGGER quotation_save_requests_immutable BEFORE UPDATE OR DELETE ON public.quotation_save_requests FOR EACH ROW EXECUTE FUNCTION public.reject_quotation_artifact_mutation();
-- Existing quote writes must use the authoritative RPC. Definer functions retain access.
REVOKE INSERT,UPDATE ON public.quotes FROM PUBLIC,anon,authenticated,service_role;
DROP POLICY "quotes: instructor read linked" ON public.quotes;
CREATE POLICY "quotes: instructor read linked" ON public.quotes FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.orders o WHERE o.quote_id=quotes.id AND o.instructor_id=public.get_my_instructor_id())
);
ALTER TABLE public.orders ADD COLUMN quotation_snapshot jsonb;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.orders WHERE quote_id IS NOT NULL GROUP BY quote_id HAVING count(*)>1)
 THEN RAISE EXCEPTION 'quotation_duplicate_order_links_require_review' USING ERRCODE='PT409'; END IF;
END $$;
CREATE UNIQUE INDEX orders_one_per_quotation ON public.orders(quote_id) WHERE quote_id IS NOT NULL;
CREATE FUNCTION public.guard_order_quotation_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Order RLS permits instructors/cashiers to edit ordinary orders. They must
 -- not create quotation links that would expand linked-quotation visibility.
 -- Existing links remain untouched by normal instructor/payment updates.
 IF ((TG_OP='INSERT' AND (NEW.quote_id IS NOT NULL OR NEW.quotation_snapshot IS NOT NULL))
 OR (TG_OP='UPDATE' AND (NEW.quote_id IS DISTINCT FROM OLD.quote_id OR NEW.quotation_snapshot IS DISTINCT FROM OLD.quotation_snapshot)))
 AND NOT coalesce(public.is_admin_or_ops(),false)
 THEN RAISE EXCEPTION 'quotation_link_access_denied' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD.quotation_snapshot IS NOT NULL AND
 (NEW.quotation_snapshot IS DISTINCT FROM OLD.quotation_snapshot OR NEW.quote_id IS DISTINCT FROM OLD.quote_id)
 THEN RAISE EXCEPTION 'quotation_order_snapshot_immutable' USING ERRCODE='42501'; END IF;
 IF NEW.quotation_snapshot IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM public.quotation_revisions r WHERE r.quote_id=NEW.quote_id AND r.data=NEW.quotation_snapshot)
 THEN RAISE EXCEPTION 'quotation_order_snapshot_invalid' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_order_quotation_snapshot BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_order_quotation_snapshot();
-- Deferred because the quote and its first immutable revision are inserted atomically.
-- Even a future accidental table grant cannot bypass the revision/totals contract.
CREATE FUNCTION public.guard_quotation_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.quotation_revisions r WHERE r.id=NEW.quotation_revision_id AND r.quote_id=NEW.id AND r.revision=NEW.quotation_version
 AND (r.data-ARRAY['updated_at','status','converted_to_order_id'])=(to_jsonb(NEW)-ARRAY['updated_at','status','converted_to_order_id']))
 THEN RAISE EXCEPTION 'quotation_revision_required' USING ERRCODE='42501'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER guard_quotation_revision AFTER INSERT OR UPDATE ON public.quotes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_quotation_revision();

CREATE FUNCTION public.save_quotation(
 p_request_id uuid,p_quote_id uuid,p_expected_version integer,p_data jsonb,
 p_customer_id uuid DEFAULT NULL,p_customer_version integer DEFAULT NULL,p_refresh_customer boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 q public.quotes; old_q public.quotes; c public.customers; receipt public.quotation_save_requests;
 request jsonb; d jsonb; item jsonb; items jsonb:='[]'; item_type text; k text; v jsonb;
 quantity numeric; price numeric; gross numeric:=0; discount_amount numeric; line_amount numeric;
 revision_id uuid:=pg_catalog.gen_random_uuid(); is_new boolean:=p_quote_id IS NULL;
 allowed text[]:=ARRAY['client_name','client_phone','client_email','organization','event_date','site','num_participants','notes','status','selected_activities','discount','billing_institution_name','billing_company_id','billing_accounting_email','billing_address_line','billing_city','billing_postal_code','billing_country_code'];
 text_fields text[]:=ARRAY['client_name','client_phone','client_email','organization','notes','status','site','billing_institution_name','billing_company_id','billing_accounting_email','billing_address_line','billing_city','billing_postal_code','billing_country_code'];
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin_or_ops() THEN RAISE EXCEPTION 'quotation_access_denied' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) key WHERE NOT key=ANY(allowed)) OR octet_length(p_data::text)>262144
 THEN RAISE EXCEPTION 'invalid_quotation_fields' USING ERRCODE='22023'; END IF;
 request:=jsonb_build_object('quote_id',p_quote_id,'expected_version',p_expected_version,'data',p_data,'customer_id',p_customer_id,'customer_version',p_customer_version,'refresh_customer',p_refresh_customer);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||p_request_id::text,46));
 SELECT * INTO receipt FROM public.quotation_save_requests WHERE actor_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF receipt.request_data IS DISTINCT FROM request THEN RAISE EXCEPTION 'quotation_request_conflict' USING ERRCODE='PT409'; END IF;
  RETURN receipt.response_data;
 END IF;
 IF is_new THEN
  IF p_expected_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'quotation_version_conflict' USING ERRCODE='PT409'; END IF;
  d:=jsonb_build_object('id',pg_catalog.gen_random_uuid(),'quote_number','QUO-'||nextval('public.quote_number_seq'::regclass),'quotation_version',0,'created_by',auth.uid(),'created_at',clock_timestamp(),'updated_at',clock_timestamp(),'status',U&'\05D8\05D9\05D5\05D8\05D4','discount',0,'selected_activities','[]'::jsonb);
 ELSE
  SELECT * INTO old_q FROM public.quotes WHERE id=p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'quotation_not_found' USING ERRCODE='PT409'; END IF;
  IF old_q.converted_to_order_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.orders WHERE quote_id=old_q.id) THEN RAISE EXCEPTION 'quotation_already_converted' USING ERRCODE='PT409'; END IF;
  IF p_expected_version IS NULL OR old_q.quotation_version<>p_expected_version THEN RAISE EXCEPTION 'quotation_version_conflict' USING ERRCODE='PT409'; END IF;
  d:=to_jsonb(old_q);
 END IF;
 -- The caller selects/refreshes a customer explicitly; normal same-customer edits keep the old snapshot.
 IF p_customer_id IS NOT NULL THEN
  IF is_new OR old_q.customer_id IS DISTINCT FROM p_customer_id OR p_refresh_customer IS TRUE THEN
   SELECT * INTO c FROM public.customers WHERE id=p_customer_id AND archived_at IS NULL FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'quotation_active_customer_required' USING ERRCODE='PT409'; END IF;
   IF p_customer_version IS NULL OR c.version<>p_customer_version THEN RAISE EXCEPTION 'quotation_customer_version_conflict' USING ERRCODE='PT409'; END IF;
   IF c.vat_applicable IS NULL THEN RAISE EXCEPTION 'quotation_explicit_customer_vat_required' USING ERRCODE='PT409'; END IF;
   d:=d||jsonb_build_object('customer_id',c.id,'customer_version',c.version,'customer_kind',c.customer_kind,'vat_applicable',c.vat_applicable,
    'client_name',coalesce(nullif(c.contact_name,''),c.display_name),'client_phone',coalesce(c.phone,''),'client_email',c.email,'organization',c.organization_name,
    'billing_institution_name',coalesce(nullif(c.billing_name,''),c.display_name),'billing_company_id',c.billing_company_id,'billing_accounting_email',c.billing_accounting_email,
    'billing_address_line',c.billing_address_line,'billing_city',c.billing_city,'billing_postal_code',c.billing_postal_code,'billing_country_code',c.billing_country_code);
  END IF;
 ELSE
  d:=d||jsonb_build_object('customer_id',NULL,'customer_version',NULL,'customer_kind',NULL,'vat_applicable',NULL);
 END IF;
 d:=d||p_data;
 FOREACH k IN ARRAY text_fields LOOP
  v:=d->k;
  IF v IS NOT NULL AND v<>'null'::jsonb AND (jsonb_typeof(v)<>'string' OR length(d->>k)>CASE WHEN k='notes' THEN 20000 ELSE 1000 END OR (d->>k) ~ '[\x00-\x08\x0B\x0C\x0E-\x1F]') THEN RAISE EXCEPTION 'invalid_quotation_fields' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF coalesce(length(btrim(d->>'client_name')),0) NOT BETWEEN 1 AND 300 OR d->>'client_phone' IS NULL OR length(d->>'client_phone')>100
 OR (coalesce(d->>'client_email','')<>'' AND (d->>'client_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(d->>'client_email')>320))
 OR (coalesce(d->>'billing_accounting_email','')<>'' AND (d->>'billing_accounting_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(d->>'billing_accounting_email')>320))
 OR (coalesce(d->>'billing_country_code','')<>'' AND d->>'billing_country_code' !~ '^[A-Z]{2}$')
 THEN RAISE EXCEPTION 'invalid_quotation_fields' USING ERRCODE='22023'; END IF;
 IF d->>'num_participants' IS NOT NULL AND (jsonb_typeof(d->'num_participants')<>'number' OR (d->>'num_participants')::numeric NOT BETWEEN 1 AND 1000000 OR trunc((d->>'num_participants')::numeric)<>(d->>'num_participants')::numeric)
 THEN RAISE EXCEPTION 'invalid_quotation_participants' USING ERRCODE='22023'; END IF;
 IF d->>'event_date' IS NOT NULL AND (jsonb_typeof(d->'event_date')<>'string' OR d->>'event_date' !~ '^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION 'invalid_quotation_date' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(d->'selected_activities') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'selected_activities') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_quotation_items' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(d->'selected_activities') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) key WHERE key<>ALL(ARRAY['item_type','activity_id','product_id','activity_name','price_per_person','quantity','description','image_url','images','duration_hours','site','line_total'])) THEN RAISE EXCEPTION 'invalid_quotation_item' USING ERRCODE='22023'; END IF;
  item_type:=coalesce(item->>'item_type','activity');
  IF item_type NOT IN ('activity','product') OR jsonb_typeof(item->'activity_name') IS DISTINCT FROM 'string' OR length(btrim(item->>'activity_name')) NOT BETWEEN 1 AND 500 OR jsonb_typeof(item->'price_per_person') IS DISTINCT FROM 'number'
  THEN RAISE EXCEPTION 'invalid_quotation_item' USING ERRCODE='22023'; END IF;
  price:=(item->>'price_per_person')::numeric;
  IF item ? 'quantity' AND jsonb_typeof(item->'quantity')<>'number' THEN RAISE EXCEPTION 'invalid_quotation_item' USING ERRCODE='22023'; END IF;
  quantity:=CASE WHEN item ? 'quantity' THEN (item->>'quantity')::numeric ELSE (d->>'num_participants')::numeric END;
  IF price<0 OR price>99999999.99 OR round(price,2)<>price OR quantity IS NULL OR quantity<=0 OR quantity>1000000 OR round(quantity,3)<>quantity THEN RAISE EXCEPTION 'invalid_quotation_item' USING ERRCODE='22023'; END IF;
  FOREACH k IN ARRAY ARRAY['activity_id','product_id'] LOOP
   IF item->>k IS NOT NULL AND (jsonb_typeof(item->k)<>'string' OR item->>k !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN RAISE EXCEPTION 'invalid_quotation_item' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF (item_type='activity' AND item->>'product_id' IS NOT NULL) OR (item_type='product' AND item->>'activity_id' IS NOT NULL) THEN RAISE EXCEPTION 'invalid_quotation_item' USING ERRCODE='22023'; END IF;
  FOREACH k IN ARRAY ARRAY['description','image_url','site'] LOOP
   IF item->>k IS NOT NULL AND (jsonb_typeof(item->k)<>'string' OR length(item->>k)>CASE WHEN k='description' THEN 20000 ELSE 4096 END) THEN RAISE EXCEPTION 'invalid_quotation_item' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF item->'images' IS NOT NULL AND item->'images'<>'null'::jsonb THEN
   IF jsonb_typeof(item->'images')<>'array' OR jsonb_array_length(item->'images')>20 THEN RAISE EXCEPTION 'invalid_quotation_item' USING ERRCODE='22023'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(item->'images') x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}')>4096) THEN RAISE EXCEPTION 'invalid_quotation_item' USING ERRCODE='22023'; END IF;
  END IF;
  IF item->>'duration_hours' IS NOT NULL AND (jsonb_typeof(item->'duration_hours')<>'number' OR (item->>'duration_hours')::numeric<0 OR (item->>'duration_hours')::numeric>10000) THEN RAISE EXCEPTION 'invalid_quotation_item' USING ERRCODE='22023'; END IF;
  line_amount:=round(price*quantity,2); gross:=gross+line_amount;
  IF gross>99999999.99 THEN RAISE EXCEPTION 'invalid_quotation_total' USING ERRCODE='22023'; END IF;
  items:=items||jsonb_build_array((item-'line_total')||jsonb_build_object('item_type',item_type,'quantity',quantity,'line_total',line_amount));
 END LOOP;
 IF jsonb_typeof(d->'discount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid_quotation_discount' USING ERRCODE='22023'; END IF;
 discount_amount:=(d->>'discount')::numeric;
 IF discount_amount<0 OR discount_amount>gross OR round(discount_amount,2)<>discount_amount THEN RAISE EXCEPTION 'invalid_quotation_discount' USING ERRCODE='22023'; END IF;
 d:=d||jsonb_build_object('selected_activities',items,'total_price',gross,'discount',discount_amount,'final_price',gross-discount_amount,'quotation_version',p_expected_version+1,'quotation_revision_id',revision_id,'updated_at',clock_timestamp());
 q:=jsonb_populate_record(NULL::public.quotes,d);
 IF is_new THEN INSERT INTO public.quotes SELECT q.* RETURNING * INTO q;
 ELSE
  UPDATE public.quotes SET client_name=q.client_name,client_phone=q.client_phone,client_email=q.client_email,organization=q.organization,event_date=q.event_date,site=q.site,num_participants=q.num_participants,notes=q.notes,status=q.status,
  selected_activities=q.selected_activities,total_price=q.total_price,discount=q.discount,final_price=q.final_price,
  customer_id=q.customer_id,customer_version=q.customer_version,customer_kind=q.customer_kind,vat_applicable=q.vat_applicable,
  billing_institution_name=q.billing_institution_name,billing_company_id=q.billing_company_id,billing_accounting_email=q.billing_accounting_email,billing_address_line=q.billing_address_line,billing_city=q.billing_city,billing_postal_code=q.billing_postal_code,billing_country_code=q.billing_country_code,
  quotation_version=q.quotation_version,quotation_revision_id=q.quotation_revision_id WHERE id=q.id RETURNING * INTO q;
 END IF;
 INSERT INTO public.quotation_revisions(id,quote_id,revision,data,customer_id,customer_version,customer_kind,captured_by)
 VALUES(revision_id,q.id,q.quotation_version,to_jsonb(q),q.customer_id,q.customer_version,q.customer_kind,auth.uid());
 INSERT INTO public.quotation_save_requests(actor_id,request_id,request_data,quote_id,response_data) VALUES(auth.uid(),p_request_id,request,q.id,to_jsonb(q));
 RETURN to_jsonb(q);
END $$;

CREATE FUNCTION public.convert_quotation_to_order(p_quote_id uuid,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.quotes; r public.quotation_revisions; o public.orders; snap_id uuid; activity uuid; data jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin_or_ops() THEN RAISE EXCEPTION 'quotation_access_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO q FROM public.quotes WHERE id=p_quote_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'quotation_not_found' USING ERRCODE='PT409'; END IF;
 IF q.converted_to_order_id IS NOT NULL THEN
  SELECT * INTO o FROM public.orders WHERE id=q.converted_to_order_id AND quote_id=q.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quotation_order_link_conflict' USING ERRCODE='PT409'; END IF;
  RETURN to_jsonb(o);
 END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE quote_id=q.id) THEN RAISE EXCEPTION 'quotation_order_link_conflict' USING ERRCODE='PT409'; END IF;
 IF p_expected_version IS NULL OR q.quotation_version<>p_expected_version THEN RAISE EXCEPTION 'quotation_version_conflict' USING ERRCODE='PT409'; END IF;
 IF q.status=U&'\05D1\05D5\05D8\05DC\05D4' THEN RAISE EXCEPTION 'quotation_cancelled' USING ERRCODE='PT409'; END IF;
 SELECT * INTO r FROM public.quotation_revisions WHERE id=q.quotation_revision_id AND quote_id=q.id AND revision=q.quotation_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'quotation_save_revision_required' USING ERRCODE='PT409'; END IF;
 IF q.event_date IS NULL OR q.num_participants IS NULL OR q.num_participants<1 OR q.final_price IS NULL OR q.final_price<0 OR jsonb_array_length(q.selected_activities)=0 THEN RAISE EXCEPTION 'quotation_conversion_fields_required' USING ERRCODE='PT409'; END IF;
 IF jsonb_array_length(q.selected_activities)=1 AND q.selected_activities->0->>'item_type'='activity' THEN
  SELECT id INTO activity FROM public.activities WHERE id=(q.selected_activities->0->>'activity_id')::uuid;
 END IF;
 -- Preserve the full quoted row. Leave price_per_person NULL so the existing order total trigger does not replace the discounted gross total.
 -- Canonical customer guard requires unlinked order INSERT, then immutable customer snapshot, then matching order UPDATE.
 INSERT INTO public.orders(id,client_name,client_phone,client_email,organization,activity_id,activity_date,site,num_participants,price_per_person,total_price,notes,
 billing_institution_name,billing_company_id,billing_accounting_email,billing_address_line,billing_city,billing_postal_code,billing_country_code,
 quote_id,quotation_snapshot,created_by,status,payment_status)
 VALUES(pg_catalog.gen_random_uuid(),q.client_name,q.client_phone,q.client_email,q.organization,activity,q.event_date,q.site,q.num_participants,NULL,q.final_price,q.notes,
 q.billing_institution_name,q.billing_company_id,q.billing_accounting_email,q.billing_address_line,q.billing_city,q.billing_postal_code,q.billing_country_code,
 q.id,r.data,auth.uid(),U&'\05DE\05D0\05D5\05E9\05E8',U&'\05DC\05D0 \05E9\05D5\05DC\05DD') RETURNING * INTO o;
 IF r.customer_id IS NOT NULL THEN
  IF q.vat_applicable IS NULL OR r.customer_version IS NULL OR r.customer_kind IS NULL THEN RAISE EXCEPTION 'quotation_customer_snapshot_required' USING ERRCODE='PT409'; END IF;
  data:=public.customer_snapshot_data(r.data);
  INSERT INTO public.customer_snapshots(order_id,customer_id,customer_version,customer_kind,revision,data,captured_by)
  VALUES(o.id,r.customer_id,r.customer_version,r.customer_kind,1,data,auth.uid()) RETURNING id INTO snap_id;
  UPDATE public.orders SET customer_id=r.customer_id,customer_snapshot_id=snap_id,customer_record_version=1,vat_applicable=q.vat_applicable,
  client_name=data->>'client_name',client_phone=data->>'client_phone',client_email=data->>'client_email',organization=data->>'organization',
  billing_institution_name=data->>'billing_institution_name',billing_company_id=data->>'billing_company_id',billing_accounting_email=data->>'billing_accounting_email',
  billing_address_line=data->>'billing_address_line',billing_city=data->>'billing_city',billing_postal_code=data->>'billing_postal_code',billing_country_code=data->>'billing_country_code'
  WHERE id=o.id RETURNING * INTO o;
 END IF;
 UPDATE public.quotes SET converted_to_order_id=o.id,status=U&'\05D0\05D5\05E9\05E8\05D4' WHERE id=q.id;
 RETURN to_jsonb(o);
END $$;
REVOKE ALL ON FUNCTION public.save_quotation(uuid,uuid,integer,jsonb,uuid,integer,boolean),public.convert_quotation_to_order(uuid,integer),public.reject_quotation_artifact_mutation(),public.guard_order_quotation_snapshot(),public.guard_quotation_revision() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_quotation(uuid,uuid,integer,jsonb,uuid,integer,boolean),public.convert_quotation_to_order(uuid,integer) TO authenticated;
COMMIT;
