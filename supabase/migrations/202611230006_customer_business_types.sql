-- Additive business classification. Existing customers, leads, and order snapshots stay unclassified.
-- customer_kind continues to describe the billing entity (person or organization).
BEGIN;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS customer_type text;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_customer_type_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_customer_type_check
  CHECK (customer_type IS NULL OR customer_type IN
    ('חינוכית','גפ״ן','סוכן/מפיק','חברה','לקוח פרטי'));

-- Retain legacy lead labels as-is. Only new classifications use the canonical five labels.
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_customer_type_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_customer_type_check
  CHECK (customer_type IS NULL OR customer_type IN
    ('סוכן','מפיק','חינוכית','גפ״ן','סוכן/מפיק','חברה','לקוח פרטי'));

-- The order's existing customer_snapshot_id is the historical reporting join.
-- NULL on older snapshots is intentionally unknown; do not infer it from today's customer card.
ALTER TABLE public.customer_snapshots ADD COLUMN IF NOT EXISTS customer_type text;
ALTER TABLE public.customer_snapshots DROP CONSTRAINT IF EXISTS customer_snapshots_customer_type_check;
ALTER TABLE public.customer_snapshots ADD CONSTRAINT customer_snapshots_customer_type_check
  CHECK (customer_type IS NULL OR customer_type IN
    ('חינוכית','גפ״ן','סוכן/מפיק','חברה','לקוח פרטי'));

CREATE OR REPLACE FUNCTION public.freeze_order_customer_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT c.customer_type INTO NEW.customer_type
  FROM public.customers c WHERE c.id = NEW.customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE = '23503'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS freeze_order_customer_type ON public.customer_snapshots;
CREATE TRIGGER freeze_order_customer_type BEFORE INSERT ON public.customer_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.freeze_order_customer_type();
REVOKE ALL ON FUNCTION public.freeze_order_customer_type() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_customer(p_data jsonb,p_id uuid DEFAULT NULL,p_expected_version integer DEFAULT NULL)
RETURNS public.customers LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row public.customers; v_new public.customers; v_fields text[] := ARRAY[
 'vat_applicable','customer_kind','customer_type','display_name','contact_name','phone','email','organization_name','billing_name',
 'billing_company_id','billing_accounting_email','billing_address_line','billing_city','billing_postal_code','billing_country_code'];
BEGIN
 IF NOT (public.is_admin_or_ops() OR public.is_cashier()) THEN RAISE EXCEPTION 'customer access denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(p_data) WHERE NOT key=ANY(v_fields) OR (key='vat_applicable' AND jsonb_typeof(value)<>'boolean') OR (key<>'vat_applicable' AND jsonb_typeof(value) NOT IN ('string','null'))) THEN
  RAISE EXCEPTION 'invalid customer fields' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_data->'vat_applicable') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'explicit_vat_required' USING ERRCODE='22023'; END IF;
 p_id := coalesce(p_id,pg_catalog.gen_random_uuid());
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,29));
 SELECT * INTO v_row FROM public.customers WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF p_expected_version IS NULL THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_each(p_data) WHERE (to_jsonb(v_row)->key) IS DISTINCT FROM value) THEN RETURN v_row; END IF;
   RAISE EXCEPTION 'customer_version_conflict' USING ERRCODE='40001';
  END IF;
  IF v_row.version<>p_expected_version THEN RAISE EXCEPTION 'customer_version_conflict' USING ERRCODE='40001'; END IF;
  v_new := jsonb_populate_record(v_row,p_data);
  UPDATE public.customers SET vat_applicable=v_new.vat_applicable,customer_kind=v_new.customer_kind,customer_type=v_new.customer_type,display_name=v_new.display_name,
   contact_name=v_new.contact_name,phone=v_new.phone,email=v_new.email,organization_name=v_new.organization_name,
   billing_name=v_new.billing_name,billing_company_id=v_new.billing_company_id,billing_accounting_email=v_new.billing_accounting_email,
   billing_address_line=v_new.billing_address_line,billing_city=v_new.billing_city,billing_postal_code=v_new.billing_postal_code,billing_country_code=v_new.billing_country_code
  WHERE id=p_id RETURNING * INTO v_row;
 ELSE
  IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'customer_version_conflict' USING ERRCODE='40001'; END IF;
  v_new := jsonb_populate_record(NULL::public.customers,jsonb_build_object('customer_kind','person')||p_data);
  INSERT INTO public.customers(id,vat_applicable,customer_kind,customer_type,display_name,contact_name,phone,email,organization_name,
   billing_name,billing_company_id,billing_accounting_email,billing_address_line,billing_city,billing_postal_code,billing_country_code)
  VALUES(p_id,v_new.vat_applicable,v_new.customer_kind,v_new.customer_type,v_new.display_name,v_new.contact_name,v_new.phone,v_new.email,v_new.organization_name,
   v_new.billing_name,v_new.billing_company_id,v_new.billing_accounting_email,v_new.billing_address_line,v_new.billing_city,v_new.billing_postal_code,v_new.billing_country_code)
  RETURNING * INTO v_row;
 END IF;
 RETURN v_row;
END $$;
COMMIT;
