-- Additive gates; existing preparations and historic register fields stay untouched.
BEGIN;
CREATE TABLE public.immediate_accounting_vat_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 rate_percent numeric NOT NULL CHECK(rate_percent>0 AND rate_percent<=100),
 evidence_reference text NOT NULL
);
INSERT INTO public.immediate_accounting_vat_policy VALUES(true,18,'reviewed Rivhit Accounting.VatRate metadata 2026-09-30');
ALTER TABLE public.immediate_accounting_vat_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.immediate_accounting_vat_policy FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.immediate_accounting_vat_policy TO service_role;
CREATE FUNCTION public.guard_check_general_register() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE has_check boolean;
BEGIN
 IF TG_TABLE_NAME='manual_order_payments' THEN
  IF NOT EXISTS(SELECT 1 FROM public.orders o JOIN public.customer_snapshots cs ON cs.id=o.customer_snapshot_id AND cs.order_id=o.id AND cs.customer_id=o.customer_id AND cs.revision=o.customer_record_version WHERE o.id=NEW.order_id AND jsonb_typeof(cs.data->'vat_applicable')='boolean') THEN RAISE EXCEPTION 'customer_snapshot_required'; END IF;
  has_check:=NEW.method='check';
 ELSE
  has_check:=NEW.method IN ('check',U&'\05E6''\05E7',U&'\05E9\05D9\05E7') OR coalesce(NEW.payment_details ?| ARRAY['check_number','checkNumber'],false);
  IF jsonb_typeof(NEW.payment_details->'lines')='array' THEN
   has_check:=has_check OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.payment_details->'lines') l WHERE l->>'method' IN ('check',U&'\05E6''\05E7',U&'\05E9\05D9\05E7') OR l ?| ARRAY['check_number','checkNumber']);
  END IF;
 END IF;
 IF has_check THEN
  IF NEW.register_code IS NOT NULL AND NEW.register_code<>'GENERAL' THEN RAISE EXCEPTION 'check_general_register_required'; END IF;
  NEW.register_code:='GENERAL';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_sale_general_register BEFORE INSERT OR UPDATE OF method,payment_details,register_code ON public.sales FOR EACH ROW EXECUTE FUNCTION public.guard_check_general_register();
CREATE TRIGGER check_manual_general_register BEFORE INSERT ON public.manual_order_payments FOR EACH ROW EXECUTE FUNCTION public.guard_check_general_register();
CREATE OR REPLACE FUNCTION public.prepare_immediate_accounting(p_order_id uuid,p_actor_id uuid,p_snapshot jsonb,p_hash text,p_mapping_required boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE frozen public.customer_snapshots%ROWTYPE; d jsonb; v_rate numeric; v_vat integer; o public.orders%ROWTYPE; s public.sales%ROWTYPE; p public.payment_transactions%ROWTYPE; m public.manual_order_payments%ROWTYPE;
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
 SELECT * INTO frozen FROM public.customer_snapshots WHERE id=o.customer_snapshot_id;
 IF NOT FOUND OR frozen.order_id IS DISTINCT FROM o.id OR frozen.customer_id IS DISTINCT FROM o.customer_id OR frozen.revision IS DISTINCT FROM o.customer_record_version THEN RAISE EXCEPTION 'customer_snapshot_required'; END IF;
 d:=frozen.data;
 IF jsonb_typeof(d->'vat_applicable') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'customer_vat_required'; END IF;
 IF p_snapshot->'billing'->>'customerId' IS DISTINCT FROM frozen.customer_id::text
 OR p_snapshot->'billing'->>'customerSnapshotId' IS DISTINCT FROM frozen.id::text
 OR p_snapshot->'billing'->>'customerVersion' IS DISTINCT FROM frozen.customer_version::text
 OR p_snapshot->'billing'->'vatApplicable' IS DISTINCT FROM d->'vat_applicable'
 OR p_snapshot->'billing'->>'name' IS DISTINCT FROM coalesce(nullif(d->>'billing_institution_name',''),nullif(d->>'organization',''),d->>'client_name','')
 OR p_snapshot->'billing'->>'email' IS DISTINCT FROM coalesce(nullif(d->>'billing_accounting_email',''),d->>'client_email','')
 OR coalesce(p_snapshot->'billing'->>'phone','') IS DISTINCT FROM coalesce(d->>'client_phone','')
 OR coalesce(p_snapshot->'billing'->>'companyId','') IS DISTINCT FROM coalesce(d->>'billing_company_id','')
 OR coalesce(p_snapshot->'billing'->>'address','') IS DISTINCT FROM coalesce(d->>'billing_address_line','')
 OR coalesce(p_snapshot->'billing'->>'city','') IS DISTINCT FROM coalesce(d->>'billing_city','')
 OR coalesce(p_snapshot->'billing'->>'postalCode','') IS DISTINCT FROM coalesce(d->>'billing_postal_code','')
 OR coalesce(p_snapshot->'billing'->>'countryCode','') IS DISTINCT FROM coalesce(d->>'billing_country_code','')
 THEN RAISE EXCEPTION 'billing_review_changed'; END IF;
 SELECT rate_percent INTO v_rate FROM public.immediate_accounting_vat_policy WHERE singleton;
 v_vat:=CASE WHEN (d->>'vat_applicable')::boolean THEN round(s.total*100*v_rate/(100+v_rate)) ELSE 0 END;
 IF p_snapshot->'vat'->'applicable' IS DISTINCT FROM d->'vat_applicable'
 OR (p_snapshot->'vat'->>'configuredRatePercent')::numeric IS DISTINCT FROM v_rate
 OR p_snapshot->'vat'->>'policyRevision' IS DISTINCT FROM 'rivhit-account-2026-09-30'
 OR (p_snapshot->'vat'->>'vatMinor')::integer IS DISTINCT FROM v_vat
 OR (p_snapshot->'vat'->>'netMinor')::integer IS DISTINCT FROM (s.total*100)::integer-v_vat
 OR ((d->>'vat_applicable')::boolean=false AND p_snapshot->>'issuanceBlock' IS DISTINCT FROM 'vat_exemption_configuration_required')
 OR ((d->>'vat_applicable')::boolean=true AND p_snapshot ? 'issuanceBlock')
 THEN RAISE EXCEPTION 'accounting_vat_invalid'; END IF;
 IF method='check' AND (s.register_code IS DISTINCT FROM 'GENERAL' OR m.register_code IS DISTINCT FROM 'GENERAL') THEN RAISE EXCEPTION 'check_general_register_required'; END IF;
 IF p_mapping_required IS NULL OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR s.total<=0 OR s.total*100>2147483647 OR s.total IS DISTINCT FROM o.total_price OR (p_snapshot->>'amountMinor')::numeric IS DISTINCT FROM s.total*100 OR p_snapshot->>'orderId' IS DISTINCT FROM o.id::text OR p_snapshot->>'saleId' IS DISTINCT FROM s.id::text
 OR p_snapshot->>'companyId' IS DISTINCT FROM '512783333' OR p_snapshot->'billing'->>'approved' IS DISTINCT FROM 'true' OR p_snapshot->'billing'->>'noPriorInvoice' IS DISTINCT FROM 'true'
 OR p_snapshot->'document'->>'document_type' IS DISTINCT FROM '2' OR p_snapshot->'document'->>'sort_code' IS DISTINCT FROM '100'
 OR p_snapshot->'document'->>'price_include_vat' IS DISTINCT FROM 'true' OR p_snapshot->'document'->>'send_mail' IS DISTINCT FROM 'false'
 OR p_snapshot->'document'->>'prevent_duplicates' IS DISTINCT FROM 'true' OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'

 OR p_snapshot->>'sourceId' IS DISTINCT FROM coalesce(p.id,m.id)::text
 OR (p_snapshot->'vat'->>'vatPercent')::numeric IS DISTINCT FROM (CASE WHEN (d->>'vat_applicable')::boolean THEN v_rate ELSE 0 END)
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
 OR p_expected->>'documentType' IS DISTINCT FROM '2' OR p_expected->>'vatPercent' IS DISTINCT FROM a.snapshot->'vat'->>'vatPercent'
 OR p_expected->'vat' IS DISTINCT FROM a.snapshot->'vat'
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

CREATE OR REPLACE FUNCTION public.immediate_accounting_source_is_valid(p_preparation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
 SELECT 1 FROM public.immediate_accounting_preparations a
 JOIN public.orders o ON o.id=a.order_id
 JOIN public.sales s ON s.id=a.sale_id AND s.order_id=o.id
 WHERE a.id=p_preparation_id AND a.snapshot->'vat'->>'applicable'='true' AND a.snapshot->'billing'->>'vatApplicable'='true' AND NOT (a.snapshot ? 'issuanceBlock')
 AND a.snapshot->'billing'->>'customerSnapshotId'=o.customer_snapshot_id::text
 AND (a.method<>'check' OR s.register_code='GENERAL') AND o.order_number<>'ORD-1039'
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
COMMIT;
