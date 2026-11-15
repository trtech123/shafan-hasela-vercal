-- A blank optional accounting email must not shadow the saved contact email.
-- The customer and immutable order snapshot remain unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_payper_billing_defaults(
  p_order_id uuid,p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  'name',coalesce(nullif(btrim(c.data->>'billing_institution_name'),''),
    nullif(btrim(c.data->>'client_name'),''),''),
  'identity',regexp_replace(coalesce(c.data->>'billing_company_id',''),'[[:space:]-]','','g'),
  'email',coalesce(nullif(btrim(c.data->>'billing_accounting_email'),''),
    nullif(btrim(c.data->>'client_email'),''),''));
END $$;
REVOKE ALL ON FUNCTION public.get_payper_billing_defaults(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_payper_billing_defaults(uuid,uuid) TO service_role;

COMMIT;
