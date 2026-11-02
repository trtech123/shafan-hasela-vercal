-- Additive only: no historical backfill, no financial events, no hold release.
BEGIN;
-- Customer master is opt-in. Existing records remain unlinked and preserve scalar billing data.
CREATE FUNCTION public.customer_normalize(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT lower(regexp_replace(btrim(coalesce(p_text, '')), '[[:space:]]+', ' ', 'g'))
$$;
CREATE FUNCTION public.customer_normalize_phone(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE WHEN digits LIKE '0%' THEN '972'||substr(digits,2) ELSE digits END
 FROM (SELECT regexp_replace(coalesce(p_text,''),'[^0-9]','','g') AS digits) p
$$;
CREATE TABLE public.customers (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 customer_kind text NOT NULL DEFAULT 'person' CHECK (customer_kind IN ('person','organization')),
 display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 300),
 contact_name text, phone text, email text, organization_name text,
 vat_applicable boolean, billing_name text, billing_company_id text, billing_accounting_email text,
 billing_address_line text, billing_city text, billing_postal_code text, billing_country_code text,
 search_name text GENERATED ALWAYS AS (public.customer_normalize(display_name)) STORED,
 search_organization text GENERATED ALWAYS AS (public.customer_normalize(organization_name)) STORED,
 search_email text GENERATED ALWAYS AS (public.customer_normalize(email)) STORED,
 search_phone text GENERATED ALWAYS AS (public.customer_normalize_phone(phone)) STORED,
 search_company_id text GENERATED ALWAYS AS (regexp_replace(coalesce(billing_company_id,''), '[^0-9a-zA-Z]', '', 'g')) STORED,
 archived_at timestamptz, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES public.profiles(id), updated_by uuid REFERENCES public.profiles(id)
);
CREATE INDEX customers_phone_idx ON public.customers(search_phone);
CREATE INDEX customers_company_idx ON public.customers(search_company_id);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_read ON public.customers FOR SELECT TO authenticated
 USING (public.is_admin_or_ops() OR public.is_cashier());
CREATE POLICY customers_insert ON public.customers FOR INSERT TO authenticated
 WITH CHECK ((public.is_admin_or_ops() OR public.is_cashier()) AND archived_at IS NULL);
CREATE POLICY customers_update ON public.customers FOR UPDATE TO authenticated
 USING ((public.is_admin_or_ops() OR public.is_cashier()) AND (archived_at IS NULL OR public.is_admin_or_ops()))
 WITH CHECK ((public.is_admin_or_ops() OR public.is_cashier()) AND (archived_at IS NULL OR public.is_admin_or_ops()));
REVOKE ALL ON public.customers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;

CREATE FUNCTION public.guard_customer_master() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.vat_applicable IS NULL THEN RAISE EXCEPTION 'explicit_vat_required' USING ERRCODE='22023'; END IF;
 IF TG_OP = 'INSERT' THEN
  NEW.version := 1; NEW.created_at := now(); NEW.created_by := auth.uid();
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
   RAISE EXCEPTION 'customer identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at AND NOT public.is_admin_or_ops() THEN
   RAISE EXCEPTION 'archive requires admin or operations' USING ERRCODE = '42501';
  END IF;
  NEW.version := OLD.version + 1;
 END IF;
 NEW.updated_at := now(); NEW.updated_by := auth.uid();
 RETURN NEW;
END $$;

-- Register attribution is explicit. Historical rows remain unattributed.
CREATE TABLE public.cash_registers (
 code text PRIMARY KEY CHECK(code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), active boolean NOT NULL DEFAULT true
);
INSERT INTO public.cash_registers(code,name) VALUES('GENERAL',U&'\05DB\05DC\05DC\05D9');
ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_registers_staff_read ON public.cash_registers FOR SELECT TO authenticated USING(public.is_admin_or_ops() OR public.is_cashier());
REVOKE ALL ON public.cash_registers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cash_registers TO authenticated,service_role;
ALTER TABLE public.sales ADD COLUMN register_code text REFERENCES public.cash_registers(code);
ALTER TABLE public.manual_order_payments ADD COLUMN register_code text REFERENCES public.cash_registers(code);
CREATE FUNCTION public.save_cash_register(p_code text,p_name text,p_active boolean DEFAULT true)
RETURNS public.cash_registers LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cash_registers;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 IF p_code='GENERAL' AND p_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'general_register_required'; END IF;
 INSERT INTO public.cash_registers(code,name,active) VALUES(p_code,p_name,p_active)
 ON CONFLICT(code) DO UPDATE SET name=excluded.name,active=excluded.active RETURNING * INTO r; RETURN r;
END $$;

ALTER TABLE public.orders ADD COLUMN customer_id uuid REFERENCES public.customers(id),
 ADD COLUMN customer_snapshot_id uuid, ADD COLUMN customer_record_version integer NOT NULL DEFAULT 0,
 ADD COLUMN vat_applicable boolean, ADD COLUMN billing_address_line text, ADD COLUMN billing_city text,
 ADD COLUMN billing_postal_code text, ADD COLUMN billing_country_code text;
CREATE TABLE public.customer_snapshots (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.orders(id),
 customer_id uuid NOT NULL REFERENCES public.customers(id), customer_version integer NOT NULL CHECK(customer_version>0),
 customer_kind text NOT NULL CHECK(customer_kind IN ('person','organization')),
 revision integer NOT NULL CHECK(revision>0), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(), captured_by uuid NOT NULL REFERENCES public.profiles(id),
 UNIQUE(order_id,revision)
);
ALTER TABLE public.orders ADD CONSTRAINT orders_customer_snapshot_fk FOREIGN KEY(customer_snapshot_id) REFERENCES public.customer_snapshots(id);
CREATE INDEX orders_customer_idx ON public.orders(customer_id);
ALTER TABLE public.customer_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_snapshots_staff_read ON public.customer_snapshots FOR SELECT TO authenticated USING(public.is_admin_or_ops() OR public.is_cashier());
REVOKE ALL ON public.customer_snapshots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.customer_snapshots TO authenticated,service_role;
CREATE FUNCTION public.reject_customer_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'immutable_customer_artifact' USING ERRCODE='42501'; END $$;
CREATE TRIGGER customer_snapshots_immutable BEFORE UPDATE OR DELETE ON public.customer_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_customer_snapshot_mutation();
CREATE FUNCTION public.customer_snapshot_data(p_row jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('client_name',p_row->'client_name','client_phone',p_row->'client_phone','client_email',p_row->'client_email',
 'organization',p_row->'organization','billing_institution_name',p_row->'billing_institution_name','billing_company_id',p_row->'billing_company_id',
 'billing_accounting_email',p_row->'billing_accounting_email','billing_address_line',p_row->'billing_address_line','billing_city',p_row->'billing_city',
 'billing_postal_code',p_row->'billing_postal_code','billing_country_code',p_row->'billing_country_code','vat_applicable',p_row->'vat_applicable')
$$;
CREATE FUNCTION public.guard_order_customer_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.customer_snapshots;
BEGIN
 IF NEW.customer_snapshot_id IS NULL THEN
  IF NEW.customer_id IS NOT NULL OR NEW.vat_applicable IS NOT NULL OR NEW.customer_record_version<>0
   OR (TG_OP='UPDATE' AND OLD.customer_snapshot_id IS NOT NULL) THEN RAISE EXCEPTION 'customer_snapshot_required' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO s FROM public.customer_snapshots WHERE id=NEW.customer_snapshot_id;
 IF NOT FOUND OR s.order_id IS DISTINCT FROM NEW.id OR s.customer_id IS DISTINCT FROM NEW.customer_id
  OR s.revision IS DISTINCT FROM NEW.customer_record_version OR s.data IS DISTINCT FROM public.customer_snapshot_data(to_jsonb(NEW))
 THEN RAISE EXCEPTION 'customer_snapshot_immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND NEW.customer_snapshot_id IS DISTINCT FROM OLD.customer_snapshot_id
  AND NEW.customer_record_version<>OLD.customer_record_version+1 THEN RAISE EXCEPTION 'customer_version_conflict' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_order_customer_snapshot BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_order_customer_snapshot();
CREATE FUNCTION public.link_order_customer(p_order_id uuid,p_customer_id uuid,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; c public.customers; s uuid; d jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT(public.is_admin_or_ops() OR public.is_cashier()) THEN RAISE EXCEPTION 'customer_access_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
 IF p_expected_version IS NULL OR o.customer_record_version<>p_expected_version THEN RAISE EXCEPTION 'customer_version_conflict' USING ERRCODE='40001'; END IF;
 IF o.order_number='ORD-1039' OR EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control WHERE order_id=o.id) OR o.status IN (U&'\05D1\05D5\05D8\05DC',U&'\05E9\05D5\05DC\05DD') OR o.payment_status IS DISTINCT FROM U&'\05DC\05D0 \05E9\05D5\05DC\05DD'
  OR EXISTS(SELECT 1 FROM public.sales WHERE order_id=o.id OR linked_order_info->>'order_number'=o.order_number)
  OR EXISTS(SELECT 1 FROM public.payment_transactions WHERE order_id=o.id AND status NOT IN ('expired','failed'))
  OR EXISTS(SELECT 1 FROM public.pelecard_live_attempts WHERE order_id=o.id AND closed_unpaid_at IS NULL)
 THEN RAISE EXCEPTION 'unpaid_order_required'; END IF;
 SELECT * INTO c FROM public.customers WHERE id=p_customer_id AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'active_customer_required'; END IF;
 IF c.vat_applicable IS NULL THEN RAISE EXCEPTION 'explicit_vat_required'; END IF;
 d:=jsonb_build_object('client_name',coalesce(nullif(c.contact_name,''),c.display_name),'client_phone',coalesce(c.phone,''),'client_email',c.email,
 'organization',c.organization_name,'billing_institution_name',coalesce(nullif(c.billing_name,''),c.display_name),'billing_company_id',c.billing_company_id,
 'billing_accounting_email',c.billing_accounting_email,'billing_address_line',c.billing_address_line,'billing_city',c.billing_city,
 'billing_postal_code',c.billing_postal_code,'billing_country_code',c.billing_country_code,'vat_applicable',c.vat_applicable);
 INSERT INTO public.customer_snapshots(order_id,customer_id,customer_version,customer_kind,revision,data,captured_by)
 VALUES(o.id,c.id,c.version,c.customer_kind,o.customer_record_version+1,d,auth.uid()) RETURNING id INTO s;
 UPDATE public.orders SET customer_id=c.id,customer_snapshot_id=s,customer_record_version=o.customer_record_version+1,
 client_name=d->>'client_name',client_phone=d->>'client_phone',client_email=c.email,organization=c.organization_name,
 billing_institution_name=d->>'billing_institution_name',billing_company_id=c.billing_company_id,billing_accounting_email=c.billing_accounting_email,
 billing_address_line=c.billing_address_line,billing_city=c.billing_city,billing_postal_code=c.billing_postal_code,billing_country_code=c.billing_country_code,
 vat_applicable=c.vat_applicable WHERE id=o.id RETURNING * INTO o;
 RETURN to_jsonb(o);
END $$;
CREATE TRIGGER customers_guard BEFORE INSERT OR UPDATE ON public.customers
 FOR EACH ROW EXECUTE FUNCTION public.guard_customer_master();

CREATE FUNCTION public.search_customers(p_search text, p_include_archived boolean DEFAULT false)
RETURNS SETOF public.customers LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_search text := public.customer_normalize(p_search); v_digits text := public.customer_normalize_phone(p_search);
BEGIN
 IF NOT (public.is_admin_or_ops() OR public.is_cashier()) THEN RAISE EXCEPTION 'customer access denied' USING ERRCODE='42501'; END IF;
 IF p_include_archived AND NOT public.is_admin_or_ops() THEN RAISE EXCEPTION 'archive access denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT c.* FROM public.customers c WHERE (p_include_archived OR c.archived_at IS NULL)
 AND (v_search = '' OR strpos(c.search_name,v_search)>0 OR strpos(c.search_organization,v_search)>0
 OR strpos(c.search_email,v_search)>0 OR (v_digits<>'' AND strpos(c.search_phone,v_digits)>0)
 OR strpos(lower(c.search_company_id),regexp_replace(v_search,'[^0-9a-z]','','g'))>0 AND regexp_replace(v_search,'[^0-9a-z]','','g')<>'')
 ORDER BY c.search_name,c.id LIMIT 50;
END $$;

CREATE FUNCTION public.save_customer(p_data jsonb,p_id uuid DEFAULT NULL,p_expected_version integer DEFAULT NULL)
RETURNS public.customers LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row public.customers; v_new public.customers; v_fields text[] := ARRAY[
 'vat_applicable','customer_kind','display_name','contact_name','phone','email','organization_name','billing_name',
 'billing_company_id','billing_accounting_email','billing_address_line','billing_city','billing_postal_code','billing_country_code'];
BEGIN
 IF NOT (public.is_admin_or_ops() OR public.is_cashier()) THEN RAISE EXCEPTION 'customer access denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(p_data) WHERE NOT key=ANY(v_fields) OR (key='vat_applicable' AND jsonb_typeof(value)<>'boolean') OR (key<>'vat_applicable' AND jsonb_typeof(value) NOT IN ('string','null'))) THEN
  RAISE EXCEPTION 'invalid customer fields' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_data->'vat_applicable') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'explicit_vat_required' USING ERRCODE='22023'; END IF;
 -- Serializes caller-generated IDs including two concurrent create retries.
 p_id := coalesce(p_id,pg_catalog.gen_random_uuid());
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,29));
 SELECT * INTO v_row FROM public.customers WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF p_expected_version IS NULL THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_each(p_data) WHERE (to_jsonb(v_row)->key) IS DISTINCT FROM value) THEN RETURN v_row; END IF;
   RAISE EXCEPTION 'customer_version_conflict' USING ERRCODE='40001';
  END IF;
  IF v_row.version<>p_expected_version THEN RAISE EXCEPTION 'customer_version_conflict' USING ERRCODE='40001'; END IF;
  v_new := jsonb_populate_record(v_row,p_data);
  UPDATE public.customers SET vat_applicable=v_new.vat_applicable,customer_kind=v_new.customer_kind,display_name=v_new.display_name,
   contact_name=v_new.contact_name,phone=v_new.phone,email=v_new.email,organization_name=v_new.organization_name,
   billing_name=v_new.billing_name,billing_company_id=v_new.billing_company_id,billing_accounting_email=v_new.billing_accounting_email,
   billing_address_line=v_new.billing_address_line,billing_city=v_new.billing_city,billing_postal_code=v_new.billing_postal_code,billing_country_code=v_new.billing_country_code
  WHERE id=p_id RETURNING * INTO v_row;
 ELSE
  IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'customer_version_conflict' USING ERRCODE='40001'; END IF;
  v_new := jsonb_populate_record(NULL::public.customers,jsonb_build_object('customer_kind','person')||p_data);
  INSERT INTO public.customers(id,vat_applicable,customer_kind,display_name,contact_name,phone,email,organization_name,
   billing_name,billing_company_id,billing_accounting_email,billing_address_line,billing_city,billing_postal_code,billing_country_code)
  VALUES(p_id,v_new.vat_applicable,v_new.customer_kind,v_new.display_name,v_new.contact_name,v_new.phone,v_new.email,v_new.organization_name,
   v_new.billing_name,v_new.billing_company_id,v_new.billing_accounting_email,v_new.billing_address_line,v_new.billing_city,v_new.billing_postal_code,v_new.billing_country_code)
  RETURNING * INTO v_row;
 END IF;
 RETURN v_row;
END $$;
CREATE FUNCTION public.archive_customer(p_id uuid,p_expected_version integer)
RETURNS public.customers LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row public.customers;
BEGIN
 IF NOT public.is_admin_or_ops() THEN RAISE EXCEPTION 'archive access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_row FROM public.customers WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR p_expected_version IS NULL OR v_row.version<>p_expected_version THEN RAISE EXCEPTION 'customer_version_conflict' USING ERRCODE='40001'; END IF;
 UPDATE public.customers SET archived_at=coalesce(archived_at,now()) WHERE id=p_id RETURNING * INTO v_row;
 RETURN v_row;
END $$;

CREATE FUNCTION public.valid_voucher_signature(p_signature jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE stroke jsonb; point jsonb; total integer:=0; meaningful boolean:=false;
BEGIN
 IF p_signature IS NULL OR jsonb_typeof(p_signature)<>'object' OR octet_length(p_signature::text)>100000
  OR p_signature->>'width' IS DISTINCT FROM '1' OR p_signature->>'height' IS DISTINCT FROM '1'
  OR jsonb_typeof(p_signature->'strokes') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_signature->'strokes') NOT BETWEEN 1 AND 100
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_signature) k WHERE k<>ALL(ARRAY['width','height','strokes'])) THEN RETURN false; END IF;
 FOR stroke IN SELECT value FROM jsonb_array_elements(p_signature->'strokes') LOOP
  IF jsonb_typeof(stroke)<>'array' OR jsonb_array_length(stroke) NOT BETWEEN 2 AND 1000 THEN RETURN false; END IF;
  total:=total+jsonb_array_length(stroke); IF total>5000 THEN RETURN false; END IF;
  FOR point IN SELECT value FROM jsonb_array_elements(stroke) LOOP
   IF jsonb_typeof(point)<>'object' OR jsonb_typeof(point->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(point->'y') IS DISTINCT FROM 'number'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(point) k WHERE k<>ALL(ARRAY['x','y']))
    OR (point->>'x')::numeric NOT BETWEEN 0 AND 1 OR (point->>'y')::numeric NOT BETWEEN 0 AND 1 THEN RETURN false; END IF;
   meaningful:=meaningful OR point IS DISTINCT FROM stroke->0;
  END LOOP;
 END LOOP;
 RETURN meaningful;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE SEQUENCE public.hakafa_voucher_number_seq;
CREATE TABLE public.hakafa_vouchers (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), voucher_number text NOT NULL UNIQUE DEFAULT('HV-'||nextval('public.hakafa_voucher_number_seq')),
 order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id), order_number text NOT NULL,
 register_code text NOT NULL REFERENCES public.cash_registers(code), register_name text NOT NULL, customer_id uuid NOT NULL REFERENCES public.customers(id),
 customer_snapshot_id uuid NOT NULL REFERENCES public.customer_snapshots(id), customer_version integer NOT NULL,
 vat_applicable boolean NOT NULL, billing_name text NOT NULL CHECK(length(btrim(billing_name)) BETWEEN 1 AND 300), billing_company_id text, billing_accounting_email text,
 service_description text NOT NULL CHECK(length(btrim(service_description)) BETWEEN 1 AND 2000),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000), contact_name text NOT NULL CHECK(length(btrim(contact_name)) BETWEEN 1 AND 300),
 phone text NOT NULL CHECK(length(phone)<=40 AND regexp_replace(phone,'[^0-9]','','g') ~ '^[0-9]{7,15}$'), signature jsonb NOT NULL CHECK(public.valid_voucher_signature(signature)),
 created_by uuid NOT NULL REFERENCES public.profiles(id), creator_name text NOT NULL, creator_role text NOT NULL CHECK(creator_role IN ('admin','operations','cashier')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), request_data jsonb NOT NULL
);
ALTER TABLE public.hakafa_vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY hakafa_vouchers_staff_read ON public.hakafa_vouchers FOR SELECT TO authenticated USING(public.is_admin_or_ops() OR public.is_cashier());
REVOKE ALL ON public.hakafa_vouchers FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hakafa_vouchers TO authenticated,service_role;
CREATE TRIGGER hakafa_vouchers_immutable BEFORE UPDATE OR DELETE ON public.hakafa_vouchers FOR EACH ROW EXECUTE FUNCTION public.reject_customer_snapshot_mutation();
CREATE FUNCTION public.create_hakafa_voucher(p_id uuid,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  IF v.request_data IS DISTINCT FROM p_data OR v.created_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'voucher_idempotency_conflict' USING ERRCODE='40001'; END IF;
  RETURN to_jsonb(v);
 END IF;
 SELECT * INTO o FROM public.orders WHERE id=(p_data->>'order_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
 IF EXISTS(SELECT 1 FROM public.hakafa_vouchers WHERE order_id=o.id) THEN RAISE EXCEPTION 'order_voucher_exists' USING ERRCODE='40001'; END IF;
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

-- Email state is append-only, independent of payment/accounting status.
CREATE TABLE public.voucher_email_deliveries (
 id uuid PRIMARY KEY, voucher_id uuid NOT NULL UNIQUE REFERENCES public.hakafa_vouchers(id),
 requested_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.voucher_email_events (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), delivery_id uuid NOT NULL REFERENCES public.voucher_email_deliveries(id),
 status text NOT NULL CHECK(status IN ('claimed','accepted','uncertain','failed')), recipient text,
 provider_message_id text CHECK(length(provider_message_id)<=300), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(delivery_id,status), CHECK((status='claimed')=(recipient IS NOT NULL))
);
ALTER TABLE public.voucher_email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_email_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY voucher_deliveries_staff_read ON public.voucher_email_deliveries FOR SELECT TO authenticated USING(public.is_admin_or_ops() OR public.is_cashier());
CREATE POLICY voucher_email_events_staff_read ON public.voucher_email_events FOR SELECT TO authenticated USING(public.is_admin_or_ops() OR public.is_cashier());
REVOKE ALL ON public.voucher_email_deliveries,public.voucher_email_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.voucher_email_deliveries,public.voucher_email_events TO authenticated,service_role;
CREATE TRIGGER voucher_deliveries_immutable BEFORE UPDATE OR DELETE ON public.voucher_email_deliveries FOR EACH ROW EXECUTE FUNCTION public.reject_customer_snapshot_mutation();
CREATE TRIGGER voucher_email_events_immutable BEFORE UPDATE OR DELETE ON public.voucher_email_events FOR EACH ROW EXECUTE FUNCTION public.reject_customer_snapshot_mutation();
CREATE FUNCTION public.prepare_voucher_email(p_voucher_id uuid,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.voucher_email_deliveries;
BEGIN
 IF auth.uid() IS NULL OR NOT(public.is_admin_or_ops() OR public.is_cashier()) THEN RAISE EXCEPTION 'voucher_access_denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.hakafa_vouchers WHERE id=p_voucher_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'voucher_not_found'; END IF;
 SELECT * INTO d FROM public.voucher_email_deliveries WHERE voucher_id=p_voucher_id;
 IF FOUND THEN
  IF d.id IS DISTINCT FROM p_request_id OR d.requested_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'voucher_email_already_prepared' USING ERRCODE='40001'; END IF;
  RETURN to_jsonb(d);
 END IF;
 INSERT INTO public.voucher_email_deliveries(id,voucher_id,requested_by) VALUES(p_request_id,p_voucher_id,auth.uid()) RETURNING * INTO d;
 RETURN to_jsonb(d);
END $$;
CREATE FUNCTION public.claim_voucher_email(p_voucher_id uuid,p_request_id uuid,p_actor_id uuid,p_recipient text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.voucher_email_deliveries; v public.hakafa_vouchers; event_status text;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text IN ('admin','operations','cashier'))
 THEN RAISE EXCEPTION 'voucher_access_denied' USING ERRCODE='42501'; END IF;
 IF p_recipient IS NULL OR length(p_recipient)>254 OR p_recipient !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' THEN RAISE EXCEPTION 'invalid_accounting_recipient'; END IF;
 SELECT * INTO v FROM public.hakafa_vouchers WHERE id=p_voucher_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'voucher_not_found'; END IF;
 SELECT * INTO d FROM public.voucher_email_deliveries WHERE voucher_id=p_voucher_id FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO public.voucher_email_deliveries(id,voucher_id,requested_by) VALUES(p_request_id,p_voucher_id,p_actor_id) RETURNING * INTO d;
 END IF;
 IF d.id IS DISTINCT FROM p_request_id OR d.requested_by IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'voucher_email_already_prepared' USING ERRCODE='40001'; END IF;
 SELECT status INTO event_status FROM public.voucher_email_events WHERE delivery_id=d.id ORDER BY (status<>'claimed') DESC,created_at DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('claimed',false,'status',event_status); END IF;
 INSERT INTO public.voucher_email_events(delivery_id,status,recipient) VALUES(d.id,'claimed',p_recipient);
 RETURN jsonb_build_object('claimed',true,'status','claimed','voucher',jsonb_build_object('id',v.id,'created_at',v.created_at,
 'signature',v.signature,'snapshot',to_jsonb(v)-ARRAY['signature','request_data']));
END $$;
CREATE FUNCTION public.finish_voucher_email(p_request_id uuid,p_status text,p_provider_message_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior public.voucher_email_events;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'voucher_access_denied' USING ERRCODE='42501'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('accepted','uncertain','failed') THEN RAISE EXCEPTION 'invalid_email_status'; END IF;
 PERFORM 1 FROM public.voucher_email_deliveries WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.voucher_email_events WHERE delivery_id=p_request_id AND status='claimed') THEN RAISE EXCEPTION 'email_claim_required'; END IF;
 SELECT * INTO prior FROM public.voucher_email_events WHERE delivery_id=p_request_id AND status<>'claimed';
 IF FOUND THEN
  IF prior.status IS DISTINCT FROM p_status OR prior.provider_message_id IS DISTINCT FROM p_provider_message_id THEN RAISE EXCEPTION 'email_result_immutable' USING ERRCODE='40001'; END IF;
  RETURN to_jsonb(prior);
 END IF;
 INSERT INTO public.voucher_email_events(delivery_id,status,provider_message_id) VALUES(p_request_id,p_status,p_provider_message_id) RETURNING * INTO prior;
 RETURN to_jsonb(prior);
END $$;

REVOKE ALL ON FUNCTION public.guard_customer_master(),public.reject_customer_snapshot_mutation(),public.guard_order_customer_snapshot() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.search_customers(text,boolean),public.save_customer(jsonb,uuid,integer),public.archive_customer(uuid,integer),public.link_order_customer(uuid,uuid,integer),public.save_cash_register(text,text,boolean),public.create_hakafa_voucher(uuid,jsonb),public.prepare_voucher_email(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.search_customers(text,boolean),public.save_customer(jsonb,uuid,integer),public.archive_customer(uuid,integer),public.link_order_customer(uuid,uuid,integer),public.save_cash_register(text,text,boolean),public.create_hakafa_voucher(uuid,jsonb),public.prepare_voucher_email(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_voucher_email(uuid,uuid,uuid,text),public.finish_voucher_email(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_voucher_email(uuid,uuid,uuid,text),public.finish_voucher_email(uuid,text,text) TO service_role;
GRANT SELECT ON public.customers TO service_role;
COMMIT;
