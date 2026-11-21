BEGIN;

-- Keep the activity selected for an order even if its catalog row changes later.
ALTER TABLE public.orders ADD COLUMN activity_snapshot jsonb;

CREATE FUNCTION public.freeze_order_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.activity_id IS NOT DISTINCT FROM OLD.activity_id THEN
  NEW.activity_snapshot := OLD.activity_snapshot;
 ELSIF NEW.activity_id IS NULL THEN
  -- ON DELETE SET NULL must not erase the selected historical activity.
  NEW.activity_snapshot := CASE WHEN TG_OP='UPDATE' THEN OLD.activity_snapshot ELSE NULL END;
 ELSE
  SELECT pg_catalog.jsonb_build_object('id',a.id,'name',a.name,
    'description',a.description,'duration_hours',a.duration_hours)
  INTO NEW.activity_snapshot FROM public.activities a WHERE a.id=NEW.activity_id;
  IF NEW.activity_snapshot IS NULL THEN
   RAISE EXCEPTION 'order_activity_not_found' USING ERRCODE='23503';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.freeze_order_activity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_freeze_order_activity BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.freeze_order_activity();

-- Old orders can use catalog evidence only if it predates the saved order and
-- has not been modified since. Otherwise the document keeps the missing-data notice.
CREATE OR REPLACE FUNCTION public.order_confirmation_data(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; d jsonb; c jsonb; activity jsonb; actor_role text;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='PT404'; END IF;
 SELECT role INTO actor_role FROM public.profiles WHERE id=auth.uid();
 IF auth.role() IS DISTINCT FROM 'service_role' AND
    (actor_role IS NULL OR NOT (actor_role IN ('admin','operations','cashier') OR
     (actor_role='instructor' AND o.instructor_id IS NOT DISTINCT FROM public.get_my_instructor_id() AND o.instructor_id IS NOT NULL))) THEN
  RAISE EXCEPTION 'order_delivery_forbidden' USING ERRCODE='42501';
 END IF;
 SELECT pg_catalog.jsonb_object_agg(k,v) INTO d
 FROM pg_catalog.jsonb_each(pg_catalog.to_jsonb(o)) e(k,v)
 WHERE k=ANY(ARRAY['id','order_number','client_name','client_phone','client_email','organization','activity_date','start_time','end_time','site','num_participants','price_per_person','total_price','notes','status','payment_status','created_at','vat_applicable','quotation_snapshot','customer_snapshot_id','customer_record_version','billing_institution_name','billing_company_id','billing_accounting_email','billing_address_line','billing_city','billing_postal_code','billing_country_code']);
 IF o.customer_snapshot_id IS NOT NULL THEN
  SELECT s.data INTO c FROM public.customer_snapshots s WHERE s.id=o.customer_snapshot_id AND s.order_id=o.id;
  IF c IS NULL THEN RAISE EXCEPTION 'invalid_saved_order' USING ERRCODE='22023'; END IF;
 END IF;
 activity := o.activity_snapshot;
 IF activity IS NULL AND o.activity_id IS NOT NULL THEN
  SELECT pg_catalog.jsonb_build_object('id',a.id,'name',a.name,
    'description',a.description,'duration_hours',a.duration_hours)
  INTO activity FROM public.activities a
  WHERE a.id=o.activity_id AND a.updated_at<=o.created_at;
 END IF;
 RETURN d||pg_catalog.jsonb_build_object('customer_snapshot',c)||
  CASE WHEN activity IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('activity_snapshot',activity) END;
END $$;

COMMIT;
