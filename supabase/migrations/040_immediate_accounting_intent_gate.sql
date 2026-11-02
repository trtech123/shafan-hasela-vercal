-- Preparation is local review only. No permit is seeded by this migration.
-- A future, explicit operator approval must seed exactly one reviewed permit.
BEGIN;
CREATE TABLE public.immediate_accounting_activation_permits (
 preparation_id uuid PRIMARY KEY REFERENCES public.immediate_accounting_preparations(id),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 approved_by uuid NOT NULL REFERENCES public.profiles(id),
 capability_hash text NOT NULL UNIQUE CHECK(capability_hash ~ '^[a-f0-9]{64}$'),
 event_id uuid NOT NULL UNIQUE DEFAULT pg_catalog.gen_random_uuid(),
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX immediate_accounting_activation_actor_idx ON public.immediate_accounting_activation_permits(approved_by);
ALTER TABLE public.immediate_accounting_activation_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.immediate_accounting_activation_permits FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immediate_accounting_activation_permit_immutable BEFORE UPDATE OR DELETE ON public.immediate_accounting_activation_permits FOR EACH ROW EXECUTE FUNCTION public.guard_immediate_accounting_audit();

-- No historical test order, unverified payment, missing mutual sale link, or
-- changed paid amount can acquire a scoped exception to the permanent hold.
CREATE FUNCTION public.immediate_accounting_source_is_valid(p_preparation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
 SELECT 1 FROM public.immediate_accounting_preparations a
 JOIN public.orders o ON o.id=a.order_id
 JOIN public.sales s ON s.id=a.sale_id AND s.order_id=o.id
 WHERE a.id=p_preparation_id AND o.order_number<>'ORD-1039'
 AND NOT EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control c WHERE c.order_id=o.id)
 AND s.total*100=a.amount_minor AND o.total_price=s.total
 AND ((a.method='pelecard' AND EXISTS(SELECT 1 FROM public.payment_transactions p
 WHERE p.id=a.payment_id AND s.payment_transaction_id=p.id AND p.sale_id=s.id AND p.order_id=o.id
 AND p.provider='pelecard' AND p.operation='payment' AND p.status='succeeded' AND p.verified_at IS NOT NULL
 AND p.amount=s.total AND p.currency='ILS'))
 OR (a.method IN ('cash','check') AND a.payment_id IS NULL AND EXISTS(SELECT 1 FROM public.manual_order_payments m
 WHERE m.order_id=o.id AND m.sale_id=s.id AND m.method=a.method AND m.amount_minor=a.amount_minor)))
 );
$$;
CREATE FUNCTION public.has_immediate_accounting_activation(p_preparation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.immediate_accounting_preparations a
 JOIN public.immediate_accounting_activation_permits t ON t.preparation_id=a.id AND t.payload_hash=a.payload_hash AND t.event_id=a.event_id
 JOIN public.profiles actor ON actor.id=t.approved_by AND actor.role::text='admin'
 WHERE a.id=p_preparation_id AND a.issuance_approved AND a.state<>'mapping_required'
 -- Creation claims require the current paid source. Once a durable document
 -- dispatch exists, recovery follows its immutable approved identity instead
 -- of a subsequently edited order amount. Historical exclusions still apply.
 AND (public.immediate_accounting_source_is_valid(a.id)
  OR (a.dispatch_started_at IS NOT NULL AND a.expected IS NOT NULL
   AND a.expected_frozen_at IS NOT NULL
   AND a.snapshot->'document'->>'order'<>'ORD-1039'
   AND NOT EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control c WHERE c.order_id=a.order_id))));
$$;
REVOKE ALL ON FUNCTION public.immediate_accounting_source_is_valid(uuid),public.has_immediate_accounting_activation(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.activate_immediate_accounting(p_preparation_id uuid,p_actor_id uuid,p_hash text,p_capability text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.immediate_accounting_preparations%ROWTYPE; t public.immediate_accounting_activation_permits%ROWTYPE; v_event uuid;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.orders o JOIN public.immediate_accounting_preparations prep_link ON prep_link.order_id=o.id WHERE prep_link.id=p_preparation_id FOR UPDATE OF o;
 SELECT * INTO a FROM public.immediate_accounting_preparations WHERE id=p_preparation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'preparation_not_found'; END IF;
 SELECT * INTO t FROM public.immediate_accounting_activation_permits WHERE preparation_id=a.id;
 IF NOT FOUND OR t.approved_by IS DISTINCT FROM p_actor_id OR t.payload_hash IS DISTINCT FROM p_hash OR a.payload_hash IS DISTINCT FROM p_hash
 OR p_capability IS NULL OR p_capability !~ '^[a-f0-9]{64}$'
 OR t.capability_hash IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_capability,'UTF8')),'hex')
 OR a.state='mapping_required' OR NOT public.immediate_accounting_source_is_valid(a.id)
 THEN RAISE EXCEPTION 'accounting_activation_not_authorized'; END IF;
 IF a.issuance_approved AND a.event_id=t.event_id THEN RETURN a.event_id; END IF;
 IF a.state<>'held' OR a.dispatch_started_at IS NOT NULL OR a.customer_creation_started_at IS NOT NULL
 OR (a.event_id IS NOT NULL AND a.event_id<>t.event_id) THEN RAISE EXCEPTION 'accounting_activation_conflict'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_documents WHERE source_id IN(a.order_id::text,a.sale_id::text,a.payment_id::text)) THEN RAISE EXCEPTION 'existing_accounting_document'; END IF;
 IF a.event_id IS NULL THEN
  INSERT INTO public.accounting_events(id,source_type,source_id,purpose,accounting_provider,status)
  VALUES(t.event_id,CASE WHEN a.payment_id IS NULL THEN 'sale' ELSE 'payment_transaction' END,coalesce(a.payment_id,a.sale_id)::text,'immediate_sale','rivhit','configuration_required') RETURNING id INTO v_event;
  IF v_event IS NULL THEN RAISE EXCEPTION 'accounting_activation_held'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.accounting_events WHERE id=a.event_id AND source_id=coalesce(a.payment_id,a.sale_id)::text AND purpose='immediate_sale' AND accounting_provider='rivhit' AND status='configuration_required') THEN RAISE EXCEPTION 'accounting_activation_conflict'; END IF;
 END IF;
 UPDATE public.immediate_accounting_preparations SET event_id=t.event_id,issuance_approved=true,updated_at=clock_timestamp() WHERE id=a.id;
 RETURN t.event_id;
END $$;
REVOKE ALL ON FUNCTION public.activate_immediate_accounting(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_immediate_accounting(uuid,uuid,text,text) TO service_role;

CREATE TABLE public.immediate_accounting_payment_evidence (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
 sale_id uuid NOT NULL UNIQUE REFERENCES public.sales(id),
 payment_id uuid NOT NULL UNIQUE REFERENCES public.payment_transactions(id),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'mapping_required' CHECK(state='mapping_required'),
 approved_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX immediate_accounting_evidence_actor_idx ON public.immediate_accounting_payment_evidence(approved_by);
ALTER TABLE public.immediate_accounting_payment_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.immediate_accounting_payment_evidence FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.immediate_accounting_payment_evidence TO authenticated,service_role;
CREATE POLICY immediate_accounting_evidence_admin_read ON public.immediate_accounting_payment_evidence FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin'));
CREATE TRIGGER immediate_accounting_evidence_immutable BEFORE UPDATE OR DELETE ON public.immediate_accounting_payment_evidence FOR EACH ROW EXECUTE FUNCTION public.guard_immediate_accounting_audit();

CREATE OR REPLACE FUNCTION public.prepare_immediate_accounting(p_order_id uuid,p_actor_id uuid,p_snapshot jsonb,p_hash text,p_mapping_required boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; s public.sales%ROWTYPE; p public.payment_transactions%ROWTYPE; m public.manual_order_payments%ROWTYPE;
 prior public.immediate_accounting_preparations%ROWTYPE; v_evidence public.immediate_accounting_payment_evidence%ROWTYPE; event uuid; prepared uuid; source text; v_source_id text; method text;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
 SELECT * INTO prior FROM public.immediate_accounting_preparations WHERE order_id=o.id;
 IF FOUND THEN
  IF prior.payload_hash IS DISTINCT FROM p_hash OR prior.snapshot IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'accounting_snapshot_conflict'; END IF;
  RETURN prior.id;
 END IF;
 IF p_mapping_required THEN
  SELECT * INTO v_evidence FROM public.immediate_accounting_payment_evidence WHERE order_id=o.id;
  IF FOUND THEN
   IF v_evidence.payload_hash IS DISTINCT FROM p_hash OR v_evidence.snapshot IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'accounting_snapshot_conflict'; END IF;
   RETURN v_evidence.id;
  END IF;
 END IF;
 IF o.order_number='ORD-1039' OR EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control WHERE order_id=o.id)
 THEN RAISE EXCEPTION 'historical_test_accounting_held'; END IF;
 SELECT * INTO s FROM public.sales WHERE order_id=o.id;
 IF NOT FOUND OR (SELECT count(*) FROM public.sales WHERE order_id=o.id)<>1 OR o.payment_status IS NULL OR o.payment_status=U&'\05DC\05D0 \05E9\05D5\05DC\05DD' THEN RAISE EXCEPTION 'completed_sale_required'; END IF;
 SELECT * INTO p FROM public.payment_transactions WHERE id=s.payment_transaction_id;
 IF FOUND THEN
  IF p.provider IS DISTINCT FROM 'pelecard' OR p.status IS DISTINCT FROM 'succeeded' OR p.operation IS DISTINCT FROM 'payment' OR p.currency IS DISTINCT FROM 'ILS' OR p.amount IS DISTINCT FROM s.total OR p.verified_at IS NULL OR p.order_id IS DISTINCT FROM o.id OR p.sale_id IS DISTINCT FROM s.id THEN RAISE EXCEPTION 'verified_payment_required'; END IF;
  source:='payment_transaction';v_source_id:=p.id::text;method:='pelecard';
 ELSE
  SELECT * INTO m FROM public.manual_order_payments WHERE order_id=o.id AND sale_id=s.id;
  IF NOT FOUND OR m.amount_minor IS DISTINCT FROM (s.total*100)::integer THEN RAISE EXCEPTION 'authorized_manual_payment_required'; END IF;
  source:='sale';v_source_id:=s.id::text;method:=m.method;
 END IF;
 IF p_mapping_required AND (p_snapshot->>'mappingRequired' IS DISTINCT FROM 'true'
 OR p_snapshot->'paymentEvidence'->>'provider' IS DISTINCT FROM 'pelecard'
 OR p_snapshot->'paymentEvidence'->>'paymentId' IS DISTINCT FROM p.id::text
 OR p_snapshot->'paymentEvidence'->>'saleId' IS DISTINCT FROM s.id::text
 OR (p_snapshot->'paymentEvidence'->>'verifiedAt')::timestamptz IS DISTINCT FROM p.verified_at
 OR p_snapshot->'paymentEvidence'->>'currency' IS DISTINCT FROM p.currency
 OR (p_snapshot->'paymentEvidence'->>'amountMinor')::numeric IS DISTINCT FROM p.amount*100
 OR p_snapshot->'document' ?| ARRAY['payments','items']) THEN RAISE EXCEPTION 'accounting_payment_evidence_invalid'; END IF;
 -- Match exactly the canonical Edge source while the order row is locked.
 -- Empty fallback values use the same semantics as JavaScript's string ||.
 IF p_snapshot->'billing'->>'name' IS DISTINCT FROM coalesce(nullif(o.billing_institution_name,''),nullif(o.organization,''),nullif(o.client_name,''),'')
 OR p_snapshot->'billing'->>'email' IS DISTINCT FROM coalesce(nullif(o.billing_accounting_email,''),nullif(o.client_email,''),'')
 OR p_snapshot->'billing'->>'phone' IS DISTINCT FROM coalesce(o.client_phone,'')
 OR coalesce(p_snapshot->'billing'->>'companyId','') IS DISTINCT FROM coalesce(o.billing_company_id,'')
 THEN RAISE EXCEPTION 'billing_review_changed'; END IF;
 IF p_mapping_required IS NULL OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR s.total<=0 OR s.total*100>2147483647 OR s.total IS DISTINCT FROM o.total_price OR (p_snapshot->>'amountMinor')::numeric IS DISTINCT FROM s.total*100 OR p_snapshot->>'orderId' IS DISTINCT FROM o.id::text OR p_snapshot->>'saleId' IS DISTINCT FROM s.id::text
 OR p_snapshot->>'companyId' IS DISTINCT FROM '512783333' OR p_snapshot->'billing'->>'approved' IS DISTINCT FROM 'true' OR p_snapshot->'billing'->>'noPriorInvoice' IS DISTINCT FROM 'true'
 OR p_snapshot->'document'->>'document_type' IS DISTINCT FROM '2' OR p_snapshot->'document'->>'sort_code' IS DISTINCT FROM '100'
 OR p_snapshot->'document'->>'price_include_vat' IS DISTINCT FROM 'true' OR p_snapshot->'document'->>'send_mail' IS DISTINCT FROM 'false'
 OR p_snapshot->'document'->>'prevent_duplicates' IS DISTINCT FROM 'true' OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'

 OR p_snapshot->>'sourceId' IS DISTINCT FROM coalesce(p.id,m.id)::text
 OR p_snapshot->'vat'->>'vatPercent' IS DISTINCT FROM '18'
 OR p_snapshot->'vat'->>'grossMinor' IS DISTINCT FROM (s.total*100)::integer::text
 OR p_snapshot->'document'->>'currency_id' IS DISTINCT FROM '1'
 OR p_snapshot->'document'->>'default_email' IS DISTINCT FROM 'false'
 OR p_snapshot->'document'->>'digital_signature' IS DISTINCT FROM 'true'
 OR p_snapshot->'document' ?| ARRAY['email_to','email_bcc']
 OR p_snapshot->'document'->>'request_reference' IS DISTINCT FROM coalesce(p.id,m.id)::text
 OR p_snapshot->'document'->>'order' IS DISTINCT FROM o.order_number
 OR (p_mapping_required AND method<>'pelecard')
 OR (method='cash' AND p_snapshot->'document'->'payments'->0->>'payment_type' IS DISTINCT FROM '2')
 OR (method='check' AND p_snapshot->'document'->'payments'->0->>'payment_type' IS DISTINCT FROM '1')
 OR (NOT p_mapping_required AND (jsonb_array_length(p_snapshot->'document'->'payments') IS DISTINCT FROM 1 OR (p_snapshot->'document'->'payments'->0->>'amount_nis')::numeric IS DISTINCT FROM s.total)) THEN RAISE EXCEPTION 'accounting_snapshot_invalid'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_documents WHERE (source_type=source AND accounting_documents.source_id=v_source_id) OR (source_type='order' AND accounting_documents.source_id=o.id::text)) THEN RAISE EXCEPTION 'existing_accounting_document'; END IF;
 prepared:=pg_catalog.gen_random_uuid();
 IF p_mapping_required THEN
  INSERT INTO public.immediate_accounting_payment_evidence(id,order_id,sale_id,payment_id,snapshot,payload_hash,approved_by)
  VALUES(prepared,o.id,s.id,p.id,p_snapshot,p_hash,p_actor_id);
  RETURN prepared;
 END IF;
 -- A preparation never creates an outbox event. Activation owns that transition.
 INSERT INTO public.immediate_accounting_preparations(id,order_id,sale_id,payment_id,event_id,method,amount_minor,snapshot,payload_hash,request_reference,state,approved_by)
 VALUES(prepared,o.id,s.id,p.id,event,method,(s.total*100)::integer,p_snapshot,p_hash,p_snapshot->'document'->>'request_reference',CASE WHEN p_mapping_required THEN 'mapping_required' ELSE 'held' END,p_actor_id);
 RETURN prepared;
END $$;

CREATE OR REPLACE FUNCTION public.guard_immediate_accounting_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='manual_order_payments' THEN RAISE EXCEPTION 'accounting_history_immutable'; END IF;
 IF ROW(NEW.order_id,NEW.sale_id,NEW.payment_id,NEW.method,NEW.amount_minor,NEW.snapshot,NEW.payload_hash,NEW.request_reference,NEW.approved_by)
 IS DISTINCT FROM ROW(OLD.order_id,OLD.sale_id,OLD.payment_id,OLD.method,OLD.amount_minor,OLD.snapshot,OLD.payload_hash,OLD.request_reference,OLD.approved_by)
 OR (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at)
 OR (OLD.external_document_id IS NOT NULL AND NEW.external_document_id IS DISTINCT FROM OLD.external_document_id)
 OR (OLD.external_document_number IS NOT NULL AND NEW.external_document_number IS DISTINCT FROM OLD.external_document_number)
 THEN RAISE EXCEPTION 'accounting_snapshot_immutable'; END IF;
 IF NEW.event_id IS DISTINCT FROM OLD.event_id AND (OLD.event_id IS NOT NULL OR NOT NEW.issuance_approved OR NOT EXISTS(SELECT 1 FROM public.immediate_accounting_activation_permits t WHERE t.preparation_id=NEW.id AND t.payload_hash=NEW.payload_hash AND t.event_id=NEW.event_id)) THEN RAISE EXCEPTION 'accounting_event_link_immutable'; END IF;
 IF NEW.issuance_approved IS DISTINCT FROM OLD.issuance_approved AND (NOT NEW.issuance_approved OR NOT EXISTS(SELECT 1 FROM public.immediate_accounting_activation_permits t WHERE t.preparation_id=NEW.id AND t.payload_hash=NEW.payload_hash AND t.event_id=NEW.event_id)) THEN RAISE EXCEPTION 'accounting_activation_not_authorized'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.load_approved_immediate_accounting(p_preparation_id uuid,p_actor_id uuid)
RETURNS SETOF public.immediate_accounting_preparations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT a.* FROM public.immediate_accounting_preparations a WHERE a.id=p_preparation_id AND a.issuance_approved AND a.state IN ('held','ready') AND a.dispatch_started_at IS NULL AND a.event_id IS NOT NULL AND public.has_immediate_accounting_activation(a.id);
END $$;

CREATE OR REPLACE FUNCTION public.claim_immediate_accounting_customer(p_preparation_id uuid,p_actor_id uuid,p_hash text)
RETURNS SETOF public.immediate_accounting_preparations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 RETURN QUERY UPDATE public.immediate_accounting_preparations a SET customer_creation_started_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE a.id=p_preparation_id AND a.payload_hash=p_hash AND a.issuance_approved AND a.state IN ('held','ready') AND a.expected IS NULL AND a.customer_creation_started_at IS NULL AND a.dispatch_started_at IS NULL AND a.event_id IS NOT NULL AND public.has_immediate_accounting_activation(a.id) RETURNING a.*;
END $$;

CREATE OR REPLACE FUNCTION public.claim_immediate_accounting_dispatch(p_preparation_id uuid)
RETURNS SETOF public.immediate_accounting_preparations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 RETURN QUERY UPDATE public.immediate_accounting_preparations a SET state='dispatching',dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE a.id=p_preparation_id AND a.issuance_approved AND a.state IN ('held','ready') AND a.dispatch_started_at IS NULL
 AND a.expected IS NOT NULL AND a.event_id IS NOT NULL AND public.has_immediate_accounting_activation(a.id)
 RETURNING a.*;
END $$;

CREATE OR REPLACE FUNCTION public.freeze_immediate_accounting_expected(p_preparation_id uuid,p_actor_id uuid,p_hash text,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.immediate_accounting_preparations%ROWTYPE; customer public.accounting_customers%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.immediate_accounting_preparations WHERE id=p_preparation_id FOR UPDATE;
 IF NOT FOUND OR a.payload_hash IS DISTINCT FROM p_hash OR NOT a.issuance_approved OR a.event_id IS NULL OR NOT public.has_immediate_accounting_activation(a.id) THEN RAISE EXCEPTION 'accounting_expected_fence'; END IF;
 IF a.expected IS NOT NULL THEN
  IF a.expected IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'accounting_expected_immutable'; END IF;
  RETURN a.expected;
 END IF;
 IF a.dispatch_started_at IS NOT NULL OR a.state NOT IN ('held','ready') OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
 OR p_expected->>'companyId' IS DISTINCT FROM '512783333' OR p_expected->>'amountMinor' IS DISTINCT FROM a.amount_minor::text
 OR p_expected->>'documentType' IS DISTINCT FROM '2' OR p_expected->>'vatPercent' IS DISTINCT FROM '18'
 OR p_expected->>'requestReference' IS DISTINCT FROM a.request_reference
 OR p_expected->>'orderNumber' IS DISTINCT FROM a.snapshot->'document'->>'order'
 OR p_expected->>'paymentType' IS DISTINCT FROM a.snapshot->'document'->'payments'->0->>'payment_type'
 THEN RAISE EXCEPTION 'accounting_expected_invalid'; END IF;
 SELECT * INTO customer FROM public.accounting_customers WHERE id=(p_expected->>'accountingCustomerId')::uuid;
 IF NOT FOUND OR a.accounting_customer_id IS DISTINCT FROM customer.id OR customer.provider<>'rivhit' OR customer.status<>'succeeded'
 OR customer.account_namespace IS DISTINCT FROM p_expected->>'accountNamespace'
 OR customer.external_customer_id IS DISTINCT FROM p_expected->>'customerId' OR customer.external_customer_id IS NULL
 THEN RAISE EXCEPTION 'accounting_customer_invalid'; END IF;
 UPDATE public.immediate_accounting_preparations SET expected=p_expected,expected_frozen_by=p_actor_id,expected_frozen_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=a.id;
 RETURN p_expected;
END $$;

CREATE OR REPLACE FUNCTION public.persist_immediate_accounting_customer(p_preparation_id uuid,p_actor_id uuid,p_hash text,p_customer_id text,p_account_namespace text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.immediate_accounting_preparations%ROWTYPE; customer public.accounting_customers%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.immediate_accounting_preparations WHERE id=p_preparation_id FOR UPDATE;
 IF NOT FOUND OR a.payload_hash IS DISTINCT FROM p_hash OR NOT a.issuance_approved OR a.customer_creation_started_at IS NULL OR a.event_id IS NULL OR NOT public.has_immediate_accounting_activation(a.id) THEN RAISE EXCEPTION 'accounting_customer_fence'; END IF;
 IF p_customer_id IS NULL OR p_customer_id !~ '^[1-9][0-9]*$' OR nullif(btrim(p_account_namespace),'') IS NULL THEN RAISE EXCEPTION 'accounting_customer_invalid'; END IF;
 IF a.accounting_customer_id IS NOT NULL THEN
  SELECT * INTO customer FROM public.accounting_customers WHERE id=a.accounting_customer_id;
  IF customer.external_customer_id IS DISTINCT FROM p_customer_id OR customer.account_namespace IS DISTINCT FROM p_account_namespace THEN RAISE EXCEPTION 'accounting_customer_immutable'; END IF;
 ELSE
  SELECT * INTO customer FROM public.accounting_customers WHERE provider='rivhit' AND account_namespace=p_account_namespace AND external_customer_id=p_customer_id;
  IF NOT FOUND THEN
   INSERT INTO public.accounting_customers(id,provider,account_namespace,identity_key,external_customer_id,external_reference,status)
   VALUES(pg_catalog.gen_random_uuid(),'rivhit',p_account_namespace,'immediate:'||a.id::text,p_customer_id,a.customer_request_reference::text,'succeeded') RETURNING * INTO customer;
  ELSIF customer.status<>'succeeded' THEN RAISE EXCEPTION 'accounting_customer_invalid'; END IF;
  UPDATE public.immediate_accounting_preparations SET accounting_customer_id=customer.id,updated_at=clock_timestamp() WHERE id=a.id;
 END IF;
 RETURN jsonb_build_object('accountingCustomerId',customer.id,'customerId',customer.external_customer_id,'accountNamespace',customer.account_namespace);
END $$;
-- Keep is_pelecard_controlled_live_accounting_held unchanged. Only an exact
-- reviewed immediate_sale source/event may pass this trigger; aliases, legacy
-- purposes, other preparations, and the controlled historical order stay held.
CREATE OR REPLACE FUNCTION public.guard_pelecard_controlled_live_accounting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_allowed boolean := false; v_held boolean;
BEGIN
 v_held:=public.is_pelecard_controlled_live_accounting_held(NEW.source_id)
  OR (TG_OP='UPDATE' AND public.is_pelecard_controlled_live_accounting_held(OLD.source_id));
 IF TG_TABLE_NAME='accounting_events' THEN
  IF NEW.purpose='immediate_sale' AND NEW.accounting_provider='rivhit' THEN
   SELECT EXISTS(SELECT 1 FROM public.immediate_accounting_preparations a
    JOIN public.immediate_accounting_activation_permits t ON t.preparation_id=a.id AND t.payload_hash=a.payload_hash AND t.event_id=NEW.id
    JOIN public.profiles actor ON actor.id=t.approved_by AND actor.role::text='admin'
    WHERE a.state<>'mapping_required' AND NEW.source_id=coalesce(a.payment_id,a.sale_id)::text
    AND NEW.source_type=CASE WHEN a.payment_id IS NULL THEN 'sale' ELSE 'payment_transaction' END
    AND (public.immediate_accounting_source_is_valid(a.id)
     OR (a.dispatch_started_at IS NOT NULL AND public.has_immediate_accounting_activation(a.id)))) INTO v_allowed;
   IF NOT v_allowed THEN RAISE EXCEPTION 'immediate_accounting_activation_required' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF NEW.document_type_key='immediate_sale' AND NEW.provider='rivhit' THEN
   SELECT EXISTS(SELECT 1 FROM public.immediate_accounting_preparations a
    WHERE NEW.source_id=coalesce(a.payment_id,a.sale_id)::text
    AND NEW.source_type=CASE WHEN a.payment_id IS NULL THEN 'sale' ELSE 'payment_transaction' END
    AND NEW.request_reference=a.request_reference AND NEW.payload_hash=a.payload_hash
    AND NEW.external_document_type=2 AND a.dispatch_started_at IS NOT NULL
    AND NEW.accounting_customer_id=a.accounting_customer_id
    AND NEW.account_namespace=a.expected->>'accountNamespace'
    AND public.has_immediate_accounting_activation(a.id)) INTO v_allowed;
   IF NOT v_allowed THEN RAISE EXCEPTION 'immediate_accounting_activation_required' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 -- An update may not move an allowed record onto or off a held alias.
 IF TG_OP='UPDATE' AND (OLD.source_id IS DISTINCT FROM NEW.source_id OR OLD.source_type IS DISTINCT FROM NEW.source_type) AND v_held THEN v_allowed:=false; END IF;
 IF v_held AND NOT v_allowed THEN
  IF TG_TABLE_NAME='accounting_events' AND TG_OP='INSERT' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'controlled_live_accounting_hold' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
COMMIT;
