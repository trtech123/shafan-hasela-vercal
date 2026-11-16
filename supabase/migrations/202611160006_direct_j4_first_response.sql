-- Prepare direct J4 evidence capture. No dispatch setting or financial gate changes.
BEGIN;

ALTER TABLE public.physical_payment_intents ADD COLUMN first_response jsonb;
ALTER TABLE public.physical_payment_intents ADD COLUMN verified_amount_minor integer
  GENERATED ALWAYS AS (CASE WHEN state IN ('approved','succeeded')
    THEN amount_minor ELSE NULL END) STORED;
ALTER TABLE public.payper_document_ledger ADD COLUMN physical_document_id text;

CREATE FUNCTION public.record_physical_first_response(p_payment_id uuid,p_evidence jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object' OR
    length(p_evidence::text)>4096 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_evidence) AS keys(key)
      WHERE key <> ALL(ARRAY['payment','document'])) OR
    jsonb_typeof(p_evidence->'payment')<>'object' OR
    jsonb_typeof(p_evidence->'document')<>'object' OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_evidence->'payment') AS keys(key)
      WHERE key <> ALL(ARRAY['statusCode','shvaResult','shvaResultEmv',
        'transactionId','uid','approvalId','amountMinor','currency','paramX',
        'terminal','register'])) OR
    EXISTS(SELECT 1 FROM jsonb_each(p_evidence->'payment') AS fields(key,value)
      WHERE jsonb_typeof(value) NOT IN ('string','number','null')) OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_evidence->'document') AS keys(key)
      WHERE key <> ALL(ARRAY['state','status','number','url','systemId','documentId'])) OR
    EXISTS(SELECT 1 FROM jsonb_each(p_evidence->'document') AS fields(key,value)
      WHERE jsonb_typeof(value) NOT IN ('string','number','null')) OR
    (p_evidence->'payment'->>'amountMinor') IS NOT NULL AND
      (p_evidence->'payment'->>'amountMinor') !~ '^[0-9]{1,10}$'
  THEN RAISE EXCEPTION 'physical_first_response_invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO STRICT i FROM public.physical_payment_intents
    WHERE payment_id=p_payment_id FOR UPDATE;
  IF i.route<>'direct' OR i.dispatch_started_at IS NULL OR
    i.state NOT IN ('dispatching','pending','uncertain','approved','succeeded') OR
    ((p_evidence->'payment'->>'amountMinor') IS NOT NULL AND
      (p_evidence->'payment'->>'amountMinor')::integer<>i.amount_minor)
  THEN RAISE EXCEPTION 'physical_first_response_mismatch' USING ERRCODE='23514'; END IF;
  IF i.first_response IS NOT NULL THEN
    IF i.first_response=p_evidence THEN RETURN true; END IF;
    RAISE EXCEPTION 'physical_first_response_conflict' USING ERRCODE='23514';
  END IF;
  UPDATE public.physical_payment_intents SET first_response=p_evidence,
    updated_at=clock_timestamp() WHERE payment_id=p_payment_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_physical_first_response(uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_physical_first_response(uuid,jsonb) TO service_role;

CREATE FUNCTION public.get_physical_direct_source(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id;
  IF NOT FOUND OR i.route<>'direct' OR
    i.state NOT IN ('reserved','dispatching') THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',i.payment_id,'register',i.register_number,
    'amountMinor',i.amount_minor,'checkoutSnapshot',i.checkout_snapshot,
    'billingSnapshot',i.billing_snapshot);
END $$;
REVOKE ALL ON FUNCTION public.get_physical_direct_source(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_physical_direct_source(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_physical_worker_intent(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE; doc_state text;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT state INTO doc_state FROM public.payper_document_ledger
    WHERE payment_id=p_payment_id;
  RETURN jsonb_build_object('id',i.payment_id,'state',i.state,'route',i.route,
    'register',i.register_number,'amountMinor',i.amount_minor,
    'verifiedAmountMinor',i.verified_amount_minor,
    'merchantTerminal',i.terminal_number,'transactionId',i.provider_transaction_id,
    'uid',i.provider_uid,'saleId',i.sale_id,'firstResponse',i.first_response,
    'documentState',doc_state,'hostedTransactionId',i.hosted_transaction_id,
    'hostedConfirmationKey',i.hosted_confirmation_key,
    'hostedRedirectUrl',i.hosted_redirect_url);
END $$;

-- Continue document association after an interrupted worker, without J4 replay.
CREATE OR REPLACE FUNCTION public.list_physical_worker_intents()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('paymentId',payment_id,'state',state)
    ORDER BY created_at),'[]'::jsonb) INTO result
  FROM (SELECT i.payment_id,i.state,i.created_at
    FROM public.physical_payment_intents i
    LEFT JOIN public.payper_document_ledger l ON l.payment_id=i.payment_id
    WHERE i.route='direct' AND (i.state IN ('reserved','pending','uncertain','approved')
      OR (i.state='dispatching' AND i.dispatch_started_at <
        clock_timestamp()-interval '6 minutes')
      OR (i.state='succeeded' AND i.first_response->'document'->>'state'='succeeded'
        AND l.state='source_blocked'))
    ORDER BY i.created_at LIMIT 40) pending;
  RETURN result;
END $$;

CREATE FUNCTION public.record_physical_direct_document(p_payment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE; p public.payment_transactions%ROWTYPE;
  s public.sales%ROWTYPE; l public.payper_document_ledger%ROWTYPE;
  doc jsonb; payment jsonb; num text; link text; system_id text; document_id text;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO p FROM public.payment_transactions WHERE id=p_payment_id;
  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO s FROM public.sales WHERE id=l.sale_id;
  doc:=i.first_response->'document'; payment:=i.first_response->'payment';
  num:=doc->>'number'; link:=doc->>'url';
  system_id:=doc->>'systemId'; document_id:=doc->>'documentId';
  IF l.state='succeeded' AND l.document_origin='automatic' AND
    l.document_number=num AND l.document_url=link AND
    l.physical_document_system_id IS NOT DISTINCT FROM system_id AND
    l.physical_document_id IS NOT DISTINCT FROM document_id THEN RETURN true; END IF;
  IF i.payment_id IS NULL OR i.route<>'direct' OR i.state<>'succeeded' OR
    i.register_number<>'004' OR i.first_response IS NULL OR
    payment->>'transactionId' IS DISTINCT FROM i.provider_transaction_id OR
    payment->>'amountMinor' IS DISTINCT FROM i.amount_minor::text OR
    doc->>'state'<>'succeeded' OR
    doc->>'status' NOT IN ('000','OK','Success') OR
    num IS NULL OR num !~ '^[1-9][0-9]{0,29}$' OR
    link IS NULL OR link !~
      '^https://app\.payper\.co\.il/public/invoice_show/[1-9][0-9]{0,29}(\?ak=[A-Za-z0-9_-]{16,128})?$' OR
    system_id IS NULL OR system_id !~ '^[1-9][0-9]{0,29}$' OR
    split_part(split_part(link,'?',1),'/',6)<>system_id OR
    (document_id IS NOT NULL AND document_id !~ '^[A-Za-z0-9_-]{1,100}$') OR
    p.status<>'succeeded' OR p.provider<>'pelecard' OR p.operation<>'payment' OR
    p.currency<>'ILS' OR p.sale_id IS DISTINCT FROM i.sale_id OR
    p.provider_transaction_id IS DISTINCT FROM i.provider_transaction_id OR
    l.state<>'source_blocked' OR l.reconciliation_code<>'physical_provider_confirmation_required' OR
    l.sale_id IS DISTINCT FROM i.sale_id OR l.order_id IS DISTINCT FROM p.order_id OR
    s.id IS NULL OR s.payment_transaction_id IS DISTINCT FROM p_payment_id OR
    s.total IS DISTINCT FROM p.amount OR p.amount IS DISTINCT FROM i.amount_minor::numeric/100 OR
    EXISTS(SELECT 1 FROM public.accounting_documents d WHERE d.status='succeeded'
      AND d.source_id IN (p_payment_id::text,s.id::text))
  THEN RAISE EXCEPTION 'physical_direct_document_reconciliation_required' USING ERRCODE='23514'; END IF;
  UPDATE public.payper_document_ledger SET state='succeeded',document_origin='automatic',
    source_facts=jsonb_build_object('physicalPaymentId',p_payment_id,
      'providerTransactionId',i.provider_transaction_id,'providerUid',i.provider_uid,
      'firstJ4Response',true,'providerIssuedAutomatically',true),
    source_frozen_at=p.created_at,dispatch_reserved_at=p.verified_at,
    provider_trx_record_id=i.provider_transaction_id,
    document_number=num,document_url=link,physical_document_system_id=system_id,
    physical_document_id=document_id,reconciliation_code=NULL,updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_physical_direct_document(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_physical_direct_document(uuid) TO service_role;

COMMIT;
