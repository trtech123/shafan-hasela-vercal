-- Install controls only. Applying this migration does not activate Payper.
BEGIN;

ALTER TABLE public.payper_dispatch_control DROP CONSTRAINT payper_dispatch_control_enabled_check;
ALTER TABLE public.payper_dispatch_control ADD CONSTRAINT payper_enabled_requires_cutoff
 CHECK (NOT enabled OR activation_cutoff_utc IS NOT NULL);

-- The caller supplies an administrator identity, never a timestamp or quota.
-- The first activation permits at most one document reservation. The database
-- records the UTC instant; later increases require a separate reviewed release.
CREATE FUNCTION public.activate_payper_new_payments(p_actor_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 UPDATE public.payper_dispatch_control SET activation_cutoff_utc=statement_timestamp(),
  enabled=true,dispatch_remaining=1
 WHERE singleton AND activation_cutoff_utc IS NULL AND enabled=false
 RETURNING activation_cutoff_utc INTO cutoff;
 IF cutoff IS NULL THEN RAISE EXCEPTION 'payper_activation_already_recorded' USING ERRCODE='23514'; END IF;
 RETURN cutoff;
END $$;
REVOKE ALL ON FUNCTION public.activate_payper_new_payments(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.activate_payper_new_payments(uuid) TO service_role;

-- Admin-assisted checkout can show verified order snapshot defaults. This RPC
-- returns billing data only to the existing payment administrator, never to a
-- public customer URL or provider metadata.
CREATE FUNCTION public.get_payper_billing_defaults(p_order_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c public.customer_snapshots%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
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
REVOKE ALL ON FUNCTION public.get_payper_billing_defaults(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_payper_billing_defaults(uuid,uuid) TO service_role;

-- This overload wraps the unchanged live reservation in the same transaction.
-- Empty or malformed billing fields become NULL and are held for review after
-- a verified payment; they never make an otherwise payable order fail.
CREATE FUNCTION public.reserve_pelecard_live_order(
 p_order_id uuid,p_actor_id uuid,p_expected_amount_minor integer,
 p_previous_payment_id uuid,p_billing jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; o public.orders%ROWTYPE; c public.customer_snapshots%ROWTYPE;
 input jsonb; kind text; name text; identity text; email text; vat boolean;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
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
REVOKE ALL ON FUNCTION public.reserve_pelecard_live_order(uuid,uuid,integer,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_pelecard_live_order(uuid,uuid,integer,uuid,jsonb) TO service_role;

COMMIT;
