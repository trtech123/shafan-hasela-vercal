-- Additive preparation lane. Issuance remains held; no provider call or backfill.
BEGIN;
CREATE TABLE public.immediate_accounting_preparations (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
 sale_id uuid NOT NULL UNIQUE REFERENCES public.sales(id),
 payment_id uuid UNIQUE REFERENCES public.payment_transactions(id),
 event_id uuid UNIQUE REFERENCES public.accounting_events(id),
 method text NOT NULL CHECK(method IN ('pelecard','cash','check')),
 amount_minor integer NOT NULL CHECK(amount_minor>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 request_reference text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'held' CHECK(state IN ('held','mapping_required','ready','dispatching','reconciliation_required','artifact_required','succeeded','failed')),
 issuance_approved boolean NOT NULL DEFAULT false,
 dispatch_started_at timestamptz,
 external_document_number text,
 external_document_id text UNIQUE,
 document_url text,
 error_code text CHECK(error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,80}$'),
 approved_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX immediate_accounting_approved_by_idx ON public.immediate_accounting_preparations(approved_by);
CREATE TABLE public.manual_order_payments (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
 sale_id uuid NOT NULL UNIQUE REFERENCES public.sales(id),
 idempotency_key uuid NOT NULL UNIQUE,
 method text NOT NULL CHECK(method IN ('cash','check')),
 amount_minor integer NOT NULL CHECK(amount_minor>0),
 details jsonb NOT NULL,
 recorded_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX manual_order_payments_recorded_by_idx ON public.manual_order_payments(recorded_by);
ALTER TABLE public.immediate_accounting_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_order_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.immediate_accounting_preparations,public.manual_order_payments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.immediate_accounting_preparations,public.manual_order_payments TO authenticated;
CREATE POLICY immediate_accounting_admin_read ON public.immediate_accounting_preparations FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin'));
CREATE POLICY manual_payment_admin_read ON public.manual_order_payments FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin'));

CREATE FUNCTION public.guard_immediate_accounting_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='manual_order_payments' THEN RAISE EXCEPTION 'accounting_history_immutable'; END IF;
 IF ROW(NEW.order_id,NEW.sale_id,NEW.payment_id,NEW.event_id,NEW.method,NEW.amount_minor,NEW.snapshot,NEW.payload_hash,NEW.request_reference,NEW.approved_by)
 IS DISTINCT FROM ROW(OLD.order_id,OLD.sale_id,OLD.payment_id,OLD.event_id,OLD.method,OLD.amount_minor,OLD.snapshot,OLD.payload_hash,OLD.request_reference,OLD.approved_by)
 OR (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at)
 OR (OLD.external_document_id IS NOT NULL AND NEW.external_document_id IS DISTINCT FROM OLD.external_document_id)
 OR (OLD.external_document_number IS NOT NULL AND NEW.external_document_number IS DISTINCT FROM OLD.external_document_number)
 THEN RAISE EXCEPTION 'accounting_snapshot_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immediate_accounting_immutable BEFORE UPDATE OR DELETE ON public.immediate_accounting_preparations FOR EACH ROW EXECUTE FUNCTION public.guard_immediate_accounting_snapshot();
CREATE TRIGGER manual_payments_immutable BEFORE UPDATE OR DELETE ON public.manual_order_payments FOR EACH ROW EXECUTE FUNCTION public.guard_immediate_accounting_snapshot();

CREATE FUNCTION public.complete_manual_order_payment(p_order_id uuid,p_method text,p_idempotency_key uuid,p_details jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; existing public.manual_order_payments%ROWTYPE; sale uuid; payment uuid; label text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 IF p_method IS NULL OR p_method NOT IN ('cash','check') OR p_idempotency_key IS NULL OR jsonb_typeof(p_details) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_manual_payment'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
 SELECT * INTO existing FROM public.manual_order_payments WHERE order_id=p_order_id;
 IF FOUND THEN
  IF existing.idempotency_key=p_idempotency_key AND existing.method=p_method AND existing.details=p_details THEN RETURN jsonb_build_object('id',existing.id,'saleId',existing.sale_id,'duplicate',true); END IF;
  RAISE EXCEPTION 'order_already_paid';
 END IF;
 IF o.order_number='ORD-1039' OR EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control WHERE order_id=o.id) OR o.payment_status IS DISTINCT FROM U&'\05DC\05D0 \05E9\05D5\05DC\05DD' OR o.status=U&'\05D1\05D5\05D8\05DC' OR o.total_price IS NULL OR o.total_price<=0 OR o.total_price*100>2147483647
 OR EXISTS(SELECT 1 FROM public.sales WHERE order_id=o.id OR linked_order_info->>'order_number'=o.order_number)
 OR EXISTS(SELECT 1 FROM public.payment_transactions WHERE order_id=o.id AND status NOT IN ('expired','failed'))
 OR EXISTS(SELECT 1 FROM public.pelecard_live_attempts WHERE order_id=o.id AND closed_unpaid_at IS NULL)
 THEN RAISE EXCEPTION 'order_not_payable'; END IF;
 IF p_method='cash' AND p_details<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid_cash_details'; END IF;
 IF p_method='check' THEN
  IF NOT (p_details ?& ARRAY['bankCode','branchNumber','accountNumber','checkNumber','dueDate'])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_details) k WHERE k<>ALL(ARRAY['bankCode','branchNumber','accountNumber','checkNumber','dueDate']))
   OR coalesce(p_details->>'bankCode','') !~ '^[1-9][0-9]{0,2}$'
   OR coalesce(p_details->>'branchNumber','') !~ '^[1-9][0-9]{0,3}$'
   OR coalesce(p_details->>'accountNumber','') !~ '^[0-9]{1,20}$'
   OR coalesce(p_details->>'checkNumber','') !~ '^[1-9][0-9]{0,8}$'
   OR coalesce(p_details->>'dueDate','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'invalid_check_details'; END IF;
  PERFORM (p_details->>'dueDate')::date;
 END IF;
 label:=CASE p_method WHEN 'cash' THEN U&'\05DE\05D6\05D5\05DE\05DF' ELSE U&'\05E6''\05E7' END;
 sale:=pg_catalog.gen_random_uuid();payment:=pg_catalog.gen_random_uuid();
 INSERT INTO public.sales(id,order_id,total,method,items,created_by,payment_details,linked_order_info)
 VALUES(sale,o.id,o.total_price,label,jsonb_build_array(jsonb_build_object('name',o.order_number,'qty',1,'price',o.total_price)),auth.uid(),p_details,
 jsonb_build_object('order_number',o.order_number,'client_name',o.client_name));
 INSERT INTO public.manual_order_payments(id,order_id,sale_id,idempotency_key,method,amount_minor,details,recorded_by)
 VALUES(payment,o.id,sale,p_idempotency_key,p_method,(o.total_price*100)::integer,p_details,auth.uid());
 UPDATE public.orders SET payment_status=label WHERE id=o.id AND payment_status=U&'\05DC\05D0 \05E9\05D5\05DC\05DD';
 RETURN jsonb_build_object('id',payment,'saleId',sale,'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION public.complete_manual_order_payment(uuid,text,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.complete_manual_order_payment(uuid,text,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.prepare_immediate_accounting(p_order_id uuid,p_actor_id uuid,p_snapshot jsonb,p_hash text,p_mapping_required boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; s public.sales%ROWTYPE; p public.payment_transactions%ROWTYPE; m public.manual_order_payments%ROWTYPE;
 prior public.immediate_accounting_preparations%ROWTYPE; event uuid; prepared uuid; source text; v_source_id text; method text;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
 SELECT * INTO prior FROM public.immediate_accounting_preparations WHERE order_id=o.id;
 IF FOUND THEN
  IF prior.payload_hash IS DISTINCT FROM p_hash OR prior.snapshot IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'accounting_snapshot_conflict'; END IF;
  RETURN prior.id;
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
 IF NOT public.is_pelecard_controlled_live_accounting_held(v_source_id) THEN
  event:=pg_catalog.gen_random_uuid();
  INSERT INTO public.accounting_events(id,source_type,source_id,purpose,accounting_provider,status)
  VALUES(event,source,v_source_id,'immediate_sale','rivhit','configuration_required');
 END IF;
 INSERT INTO public.immediate_accounting_preparations(id,order_id,sale_id,payment_id,event_id,method,amount_minor,snapshot,payload_hash,request_reference,state,approved_by)
 VALUES(prepared,o.id,s.id,p.id,event,method,(s.total*100)::integer,p_snapshot,p_hash,p_snapshot->'document'->>'request_reference',CASE WHEN p_mapping_required THEN 'mapping_required' ELSE 'held' END,p_actor_id);
 RETURN prepared;
END $$;
REVOKE ALL ON FUNCTION public.prepare_immediate_accounting(uuid,uuid,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_immediate_accounting(uuid,uuid,jsonb,text,boolean) TO service_role;

-- Dedicated events stay inert to the generic worker; this lane owns dispatch.
CREATE FUNCTION public.guard_immediate_accounting_event() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.purpose='immediate_sale' AND NEW.status='processing' THEN RAISE EXCEPTION 'immediate_accounting_dispatch_required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immediate_accounting_event_dispatch_guard BEFORE UPDATE ON public.accounting_events FOR EACH ROW EXECUTE FUNCTION public.guard_immediate_accounting_event();
CREATE FUNCTION public.claim_immediate_accounting_dispatch(p_preparation_id uuid)
RETURNS SETOF public.immediate_accounting_preparations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 RETURN QUERY UPDATE public.immediate_accounting_preparations a SET state='dispatching',dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE a.id=p_preparation_id AND a.issuance_approved AND a.state IN ('held','ready') AND a.dispatch_started_at IS NULL
 AND a.expected IS NOT NULL AND a.event_id IS NOT NULL AND NOT public.is_pelecard_controlled_live_accounting_held(coalesce(a.payment_id,a.sale_id)::text)
 RETURNING a.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_immediate_accounting_dispatch(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_immediate_accounting_dispatch(uuid) TO service_role;
CREATE TABLE public.immediate_accounting_reconciliations (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 preparation_id uuid NOT NULL REFERENCES public.immediate_accounting_preparations(id),
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 state text NOT NULL, external_document_id text, external_document_number text, document_url text, error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX immediate_accounting_reconciliations_actor_idx ON public.immediate_accounting_reconciliations(actor_id);
CREATE INDEX immediate_accounting_reconciliations_preparation_idx ON public.immediate_accounting_reconciliations(preparation_id);
ALTER TABLE public.immediate_accounting_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.immediate_accounting_reconciliations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.immediate_accounting_reconciliations TO authenticated;
CREATE POLICY immediate_reconciliation_admin_read ON public.immediate_accounting_reconciliations FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin'));
CREATE FUNCTION public.guard_immediate_accounting_audit() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'accounting_history_immutable'; END $$;
CREATE TRIGGER immediate_accounting_audit_immutable BEFORE UPDATE OR DELETE ON public.immediate_accounting_reconciliations FOR EACH ROW EXECUTE FUNCTION public.guard_immediate_accounting_audit();
CREATE FUNCTION public.persist_immediate_accounting_result(p_preparation_id uuid,p_actor_id uuid,p_hash text,p_state text,p_external_document_id text DEFAULT NULL,p_external_document_number text DEFAULT NULL,p_document_url text DEFAULT NULL,p_error_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.immediate_accounting_preparations%ROWTYPE; v_doc uuid;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.immediate_accounting_preparations WHERE id=p_preparation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'preparation_not_found'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') OR a.payload_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'accounting_reconciliation_fence'; END IF;
 IF a.dispatch_started_at IS NULL THEN RAISE EXCEPTION 'dispatch_not_started'; END IF;
 IF p_state IS NULL OR p_state NOT IN ('reconciliation_required','artifact_required','succeeded','failed')
 OR (p_state IN ('artifact_required','succeeded') AND (nullif(btrim(p_external_document_id),'') IS NULL OR nullif(btrim(p_external_document_number),'') IS NULL))
 OR (p_state='succeeded' AND p_document_url IS NULL)
 OR (p_document_url IS NOT NULL AND p_document_url !~ '^https://[^/[:space:]@]+(/[^[:space:]]*)?$')
 OR (a.state='succeeded' AND p_state<>'succeeded')
 OR (a.external_document_id IS NOT NULL AND a.external_document_id IS DISTINCT FROM p_external_document_id)
 OR (a.external_document_number IS NOT NULL AND a.external_document_number IS DISTINCT FROM p_external_document_number)
 THEN RAISE EXCEPTION 'invalid_accounting_result'; END IF;
 UPDATE public.immediate_accounting_preparations SET state=p_state,external_document_id=p_external_document_id,external_document_number=p_external_document_number,document_url=p_document_url,error_code=p_error_code,updated_at=clock_timestamp() WHERE id=a.id;
 IF a.expected IS NULL THEN RAISE EXCEPTION 'accounting_expected_required'; END IF;
 IF p_state IN ('artifact_required','succeeded') THEN
  INSERT INTO public.accounting_documents(id,provider,account_namespace,accounting_customer_id,source_type,source_id,document_type_key,external_document_type,status,request_reference,payload_hash,external_document_id,external_document_number,document_url)
  VALUES(coalesce(a.accounting_document_id,pg_catalog.gen_random_uuid()),'rivhit',a.expected->>'accountNamespace',(a.expected->>'accountingCustomerId')::uuid,CASE WHEN a.payment_id IS NULL THEN 'sale' ELSE 'payment_transaction' END,coalesce(a.payment_id,a.sale_id)::text,'immediate_sale',2,CASE WHEN p_state='succeeded' THEN 'succeeded' ELSE 'reconciliation_required' END,a.request_reference,a.payload_hash,p_external_document_id,p_external_document_number,p_document_url)
  ON CONFLICT (provider,account_namespace,request_reference) DO UPDATE SET status=EXCLUDED.status,document_url=EXCLUDED.document_url,external_document_id=EXCLUDED.external_document_id,external_document_number=EXCLUDED.external_document_number
  WHERE accounting_documents.payload_hash=EXCLUDED.payload_hash AND accounting_documents.source_id=EXCLUDED.source_id AND accounting_documents.external_document_id IS NOT DISTINCT FROM EXCLUDED.external_document_id RETURNING id INTO v_doc;
  IF v_doc IS NULL THEN RAISE EXCEPTION 'accounting_document_conflict'; END IF;
  UPDATE public.immediate_accounting_preparations SET accounting_document_id=v_doc WHERE id=a.id;
 END IF;
 UPDATE public.accounting_events SET status=CASE WHEN p_state='succeeded' THEN 'succeeded' WHEN p_state='failed' THEN 'permanent_error' ELSE 'reconciliation_required' END WHERE id=a.event_id AND purpose='immediate_sale';
 INSERT INTO public.immediate_accounting_reconciliations(preparation_id,actor_id,state,external_document_id,external_document_number,document_url,error_code) VALUES(a.id,p_actor_id,p_state,p_external_document_id,p_external_document_number,p_document_url,p_error_code);
 RETURN jsonb_build_object('id',a.id,'state',p_state);
END $$;
REVOKE ALL ON FUNCTION public.persist_immediate_accounting_result(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_immediate_accounting_result(uuid,uuid,text,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.guard_immediate_accounting_snapshot(),public.guard_immediate_accounting_event(),public.guard_immediate_accounting_audit() FROM PUBLIC,anon,authenticated,service_role;
-- All service writes use checked RPCs. No approval writer is installed.
REVOKE ALL ON public.immediate_accounting_preparations,public.manual_order_payments FROM service_role;
GRANT SELECT ON public.immediate_accounting_preparations,public.manual_order_payments TO service_role;
CREATE FUNCTION public.get_immediate_accounting_order_gate(p_order_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('historicalControlled',EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control WHERE order_id=p_order_id),'activeLiveAttempt',EXISTS(SELECT 1 FROM public.pelecard_live_attempts WHERE order_id=p_order_id AND closed_unpaid_at IS NULL));
END $$;
REVOKE ALL ON FUNCTION public.get_immediate_accounting_order_gate(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_immediate_accounting_order_gate(uuid) TO service_role;
ALTER TABLE public.immediate_accounting_preparations
 ADD COLUMN expected jsonb,
 ADD COLUMN expected_frozen_by uuid REFERENCES public.profiles(id),
 ADD COLUMN expected_frozen_at timestamptz,
 ADD COLUMN customer_request_reference uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid() UNIQUE,
 ADD COLUMN customer_creation_started_at timestamptz,
 ADD COLUMN accounting_document_id uuid UNIQUE REFERENCES public.accounting_documents(id);
CREATE INDEX immediate_accounting_expected_actor_idx ON public.immediate_accounting_preparations(expected_frozen_by);
CREATE FUNCTION public.guard_immediate_accounting_expected() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.customer_request_reference IS DISTINCT FROM OLD.customer_request_reference
 OR (OLD.customer_creation_started_at IS NOT NULL AND NEW.customer_creation_started_at IS DISTINCT FROM OLD.customer_creation_started_at)
 OR (OLD.expected IS NOT NULL AND ROW(NEW.expected,NEW.expected_frozen_by,NEW.expected_frozen_at) IS DISTINCT FROM ROW(OLD.expected,OLD.expected_frozen_by,OLD.expected_frozen_at))
 OR (OLD.accounting_customer_id IS NOT NULL AND NEW.accounting_customer_id IS DISTINCT FROM OLD.accounting_customer_id)
 OR (OLD.accounting_document_id IS NOT NULL AND NEW.accounting_document_id IS DISTINCT FROM OLD.accounting_document_id)
 THEN RAISE EXCEPTION 'accounting_expected_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immediate_accounting_expected_immutable BEFORE UPDATE ON public.immediate_accounting_preparations FOR EACH ROW EXECUTE FUNCTION public.guard_immediate_accounting_expected();
CREATE FUNCTION public.load_approved_immediate_accounting(p_preparation_id uuid,p_actor_id uuid)
RETURNS SETOF public.immediate_accounting_preparations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT a.* FROM public.immediate_accounting_preparations a WHERE a.id=p_preparation_id AND a.issuance_approved AND a.state IN ('held','ready') AND a.dispatch_started_at IS NULL AND a.event_id IS NOT NULL AND NOT public.is_pelecard_controlled_live_accounting_held(coalesce(a.payment_id,a.sale_id)::text);
END $$;
CREATE FUNCTION public.claim_immediate_accounting_customer(p_preparation_id uuid,p_actor_id uuid,p_hash text)
RETURNS SETOF public.immediate_accounting_preparations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 RETURN QUERY UPDATE public.immediate_accounting_preparations a SET customer_creation_started_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE a.id=p_preparation_id AND a.payload_hash=p_hash AND a.issuance_approved AND a.state IN ('held','ready') AND a.expected IS NULL AND a.customer_creation_started_at IS NULL AND a.dispatch_started_at IS NULL AND a.event_id IS NOT NULL AND NOT public.is_pelecard_controlled_live_accounting_held(coalesce(a.payment_id,a.sale_id)::text) RETURNING a.*;
END $$;
CREATE FUNCTION public.freeze_immediate_accounting_expected(p_preparation_id uuid,p_actor_id uuid,p_hash text,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.immediate_accounting_preparations%ROWTYPE; customer public.accounting_customers%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.immediate_accounting_preparations WHERE id=p_preparation_id FOR UPDATE;
 IF NOT FOUND OR a.payload_hash IS DISTINCT FROM p_hash OR NOT a.issuance_approved OR a.event_id IS NULL OR public.is_pelecard_controlled_live_accounting_held(coalesce(a.payment_id,a.sale_id)::text) THEN RAISE EXCEPTION 'accounting_expected_fence'; END IF;
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
REVOKE ALL ON FUNCTION public.guard_immediate_accounting_expected() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.load_approved_immediate_accounting(uuid,uuid),public.claim_immediate_accounting_customer(uuid,uuid,text),public.freeze_immediate_accounting_expected(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.load_approved_immediate_accounting(uuid,uuid),public.claim_immediate_accounting_customer(uuid,uuid,text),public.freeze_immediate_accounting_expected(uuid,uuid,text,jsonb) TO service_role;

ALTER TABLE public.immediate_accounting_preparations ADD COLUMN accounting_customer_id uuid REFERENCES public.accounting_customers(id);
CREATE INDEX immediate_accounting_customer_idx ON public.immediate_accounting_preparations(accounting_customer_id);
CREATE FUNCTION public.persist_immediate_accounting_customer(p_preparation_id uuid,p_actor_id uuid,p_hash text,p_customer_id text,p_account_namespace text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.immediate_accounting_preparations%ROWTYPE; customer public.accounting_customers%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin') THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.immediate_accounting_preparations WHERE id=p_preparation_id FOR UPDATE;
 IF NOT FOUND OR a.payload_hash IS DISTINCT FROM p_hash OR NOT a.issuance_approved OR a.customer_creation_started_at IS NULL OR a.event_id IS NULL OR public.is_pelecard_controlled_live_accounting_held(coalesce(a.payment_id,a.sale_id)::text) THEN RAISE EXCEPTION 'accounting_customer_fence'; END IF;
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
REVOKE ALL ON FUNCTION public.persist_immediate_accounting_customer(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_immediate_accounting_customer(uuid,uuid,text,text,text) TO service_role;

COMMIT;

