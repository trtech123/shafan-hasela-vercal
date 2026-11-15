-- Depends on 202611150001: multiple partial documents per order and shared
-- paid/balance status semantics. No J4 call or invoice issuance occurs here.
BEGIN;

DO $$ BEGIN
  IF pg_catalog.to_regclass('public.payper_noncard_payments') IS NULL THEN
    RAISE EXCEPTION 'payper_order_collection_migration_required';
  END IF;
END $$;

-- Hosted checkout still charges an original order total. Physical reservations
-- use the locked, server-computed balance and carry a correlated source order.
CREATE OR REPLACE FUNCTION public.guard_hosted_after_noncard_partial() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.provider='pelecard' AND NEW.operation='payment' AND NEW.order_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.payper_noncard_payments n WHERE n.order_id=NEW.order_id)
    AND (NEW.idempotency_key='physical-'||NEW.id::text
      AND NEW.checkout_snapshot->'source_order'->>'orderId'=NEW.order_id::text
      AND (NEW.checkout_snapshot->'source_order'->>'collected')::numeric=NEW.amount) IS NOT TRUE
  THEN RAISE EXCEPTION 'hosted_partial_balance_unsupported' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.reserve_physical_order_payment(
  p_actor_id uuid,p_request_key uuid,p_workstation_code text,p_order_id uuid,
  p_amount_minor integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  o public.orders%ROWTYPE; d public.physical_terminal_devices%ROWTYPE;
  i public.physical_payment_intents%ROWTYPE; p public.payment_transactions%ROWTYPE;
  paid numeric:=0; legacy_paid numeric:=0; balance numeric; amount numeric;
  billing jsonb; snapshot jsonb; payment_id uuid; activity_name text;
  customer_kind text; quote_discount numeric;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text IN ('admin','cashier'))
    OR p_request_key IS NULL OR p_order_id IS NULL OR p_workstation_code IS NULL OR
    p_amount_minor NOT BETWEEN 1 AND 2147483647
  THEN RAISE EXCEPTION 'physical_order_reservation_invalid' USING ERRCODE='23514'; END IF;

  SELECT * INTO i FROM public.physical_payment_intents WHERE request_key=p_request_key;
  IF FOUND THEN
    SELECT * INTO p FROM public.payment_transactions WHERE id=i.payment_id;
    IF i.created_by IS DISTINCT FROM p_actor_id OR
      i.workstation_code IS DISTINCT FROM p_workstation_code OR
      i.amount_minor IS DISTINCT FROM p_amount_minor OR p.order_id IS DISTINCT FROM p_order_id
    THEN RAISE EXCEPTION 'physical_request_conflict' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('paymentId',i.payment_id,'orderId',p.order_id,
      'amountMinor',i.amount_minor,'state',i.state,'registerNumber',i.register_number);
  END IF;

  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR o.archived_at IS NOT NULL OR o.status='בוטל' OR
    o.total_price IS NULL OR o.total_price<=0 OR
    o.total_price*100<>trunc(o.total_price*100) OR o.vat_applicable IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'physical_order_not_payable' USING ERRCODE='23514'; END IF;
  -- J4 automatically issues an Invoice-Receipt. An order-level tax document or
  -- an uncertain prior payment document must be reviewed before another charge.
  -- A settled document for a distinct earlier partial payment is permitted.
  IF EXISTS(SELECT 1 FROM public.accounting_documents doc
      WHERE ((doc.source_type='order' AND doc.source_id=o.id::text AND
             doc.status<>'permanent_error') OR
         (doc.source_type='sale' AND EXISTS(SELECT 1 FROM public.sales s
           WHERE s.order_id=o.id AND s.id::text=doc.source_id) AND
           doc.status IN ('processing','reconciliation_required')) OR
         (doc.source_type='payment_transaction' AND EXISTS
           (SELECT 1 FROM public.payment_transactions t
             WHERE t.order_id=o.id AND t.id::text=doc.source_id) AND
           doc.status IN ('processing','reconciliation_required'))))
    OR EXISTS(SELECT 1 FROM public.payper_document_ledger l WHERE l.order_id=o.id
      AND l.state IN ('dispatch_reserved','reconciliation_required'))
  THEN RAISE EXCEPTION 'physical_order_document_review_required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id IS NULL AND
    s.linked_order_info->>'order_number'=o.order_number)
    OR EXISTS(SELECT 1 FROM public.payment_transactions t WHERE t.order_id IS NULL AND
      t.checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
  THEN RAISE EXCEPTION 'physical_order_legacy_link_unresolved' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.payment_transactions t WHERE t.order_id=o.id
    AND t.operation='payment' AND t.status IN ('initiated','pending_provider','timed_out'))
  THEN RAISE EXCEPTION 'order_payment_unresolved' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(CASE WHEN t.operation='refund' AND t.status='refunded' THEN -t.amount
    WHEN t.operation='payment' AND t.status='succeeded' THEN t.amount ELSE 0 END),0)
    INTO paid FROM public.payment_transactions t WHERE t.order_id=o.id;
  SELECT coalesce(sum(s.total),0) INTO legacy_paid FROM public.sales s
    WHERE s.order_id=o.id AND s.payment_transaction_id IS NULL AND
      s.method IN ('צ''ק','מזומן');
  paid:=paid+legacy_paid; balance:=o.total_price-paid;
  IF o.payment_status NOT IN ('לא שולם','שולם חלקית') AND balance>0
  THEN RAISE EXCEPTION 'physical_order_status_unresolved' USING ERRCODE='23514'; END IF;
  amount:=p_amount_minor::numeric/100;
  IF balance<=0 OR p_amount_minor::numeric/100>balance OR
    (EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='cashier')
      AND amount<>balance)
  THEN RAISE EXCEPTION 'physical_order_balance_mismatch' USING ERRCODE='23514'; END IF;

  SELECT * INTO d FROM public.physical_terminal_devices
    WHERE cash_register_code=p_workstation_code AND enabled FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.cash_registers
    WHERE code=p_workstation_code AND active)
  THEN RAISE EXCEPTION 'physical_register_unassigned' USING ERRCODE='23514'; END IF;

  SELECT name INTO activity_name FROM public.activities WHERE id=o.activity_id;
  SELECT cs.customer_kind INTO customer_kind FROM public.customer_snapshots cs
    WHERE cs.id=o.customer_snapshot_id AND cs.order_id=o.id;
  SELECT q.discount INTO quote_discount FROM public.quotes q WHERE q.id=o.quote_id;
  customer_kind:=coalesce(customer_kind,CASE WHEN nullif(btrim(o.organization),'') IS NULL
    THEN 'person' ELSE 'organization' END);
  billing:=jsonb_build_object('kind',customer_kind,
    'name',coalesce(nullif(btrim(o.billing_institution_name),''),
      nullif(btrim(o.organization),''),o.client_name),
    'identity',coalesce(nullif(btrim(o.billing_company_id),''),
      nullif(btrim(o.billing_signer_id),'')),
    'email',coalesce(nullif(btrim(o.billing_accounting_email),''),o.client_email),
    'vatApplicable',o.vat_applicable,'orderId',o.id,
    'orderNumber',o.order_number);
  IF coalesce(billing->>'name','')='' OR
    coalesce(billing->>'identity','') !~ '^[0-9]{9}$' OR
    coalesce(billing->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN RAISE EXCEPTION 'physical_order_billing_incomplete' USING ERRCODE='23514'; END IF;
  snapshot:=jsonb_build_object('schema_version',1,
    'items',jsonb_build_array(jsonb_build_object('id',o.id::text,
      'name',coalesce(nullif(btrim(activity_name),''),'פעילות קבוצתית')||' — '||o.order_number,
      'qty',1,'customPrice',amount)),
    'discount',NULL,
    'linked_order_info',jsonb_build_object('order_number',o.order_number,
      'client_name',o.client_name,'client_phone',o.client_phone,
      'organization',coalesce(o.organization,'')),
    'source_order',jsonb_build_object('orderId',o.id,'originalTotal',o.total_price,
      'paidBefore',paid,'balanceBefore',balance,'collected',amount,
      'quoteId',o.quote_id,'quoteDiscount',quote_discount,
      'vatApplicable',o.vat_applicable,'customerKind',customer_kind,
      'participants',o.num_participants,'pricePerPerson',o.price_per_person),
    'sale_date',(clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date::text);
  payment_id:=gen_random_uuid();
  INSERT INTO public.payment_transactions(id,provider,operation,order_id,amount,
    currency,status,idempotency_key,checkout_snapshot,created_by)
    VALUES(payment_id,'pelecard','payment',o.id,amount,'ILS','initiated',
      'physical-'||payment_id::text,snapshot,p_actor_id);
  INSERT INTO public.physical_payment_intents(payment_id,request_key,created_by,
    workstation_code,register_number,terminal_number,amount_minor,
    checkout_snapshot,billing_snapshot)
    VALUES(payment_id,p_request_key,p_actor_id,p_workstation_code,d.register_number,
      '2814926015',p_amount_minor,snapshot,billing);
  INSERT INTO public.payper_payment_billing_snapshots(payment_id,order_id,
    source_customer_snapshot_id,customer_kind,billing_name,billing_identity,
    billing_email,vat_applicable)
    VALUES(payment_id,o.id,o.customer_snapshot_id,customer_kind,
      billing->>'name',billing->>'identity',billing->>'email',o.vat_applicable);
  RETURN jsonb_build_object('paymentId',payment_id,'orderId',o.id,
    'amountMinor',p_amount_minor,'state','reserved','registerNumber',d.register_number);
END $$;
REVOKE ALL ON FUNCTION public.reserve_physical_order_payment(uuid,uuid,text,uuid,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_physical_order_payment(uuid,uuid,text,uuid,integer)
  TO service_role;

-- Only this physical wrapper handles partial order status. Hosted checkout
-- continues to use finalize_pelecard_payment unchanged.
CREATE OR REPLACE FUNCTION public.finalize_physical_payment(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  i public.physical_payment_intents%ROWTYPE; p public.payment_transactions%ROWTYPE;
  o public.orders%ROWTYPE; result jsonb; sale uuid;
  paid numeric:=0; legacy_paid numeric:=0; balance numeric;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT p FROM public.payment_transactions WHERE id=p_payment_id;
  IF p.order_id IS NOT NULL THEN
    SELECT * INTO STRICT o FROM public.orders WHERE id=p.order_id FOR UPDATE;
  END IF;
  SELECT * INTO STRICT i FROM public.physical_payment_intents
    WHERE payment_id=p_payment_id FOR UPDATE;
  IF i.state='succeeded' THEN
    RETURN jsonb_build_object('state','succeeded','paymentId',p_payment_id,'saleId',i.sale_id);
  END IF;
  IF i.state<>'approved' OR i.provider_transaction_id IS NULL OR
    i.provider_uid IS NULL OR i.approval_id IS NULL
  THEN RAISE EXCEPTION 'physical_approval_required' USING ERRCODE='23514'; END IF;
  IF p.order_id IS NOT NULL THEN
    SELECT coalesce(sum(CASE WHEN t.operation='refund' AND t.status='refunded' THEN -t.amount
      WHEN t.operation='payment' AND t.status='succeeded' THEN t.amount ELSE 0 END),0)
      INTO paid FROM public.payment_transactions t WHERE t.order_id=o.id;
    SELECT coalesce(sum(s.total),0) INTO legacy_paid FROM public.sales s
      WHERE s.order_id=o.id AND s.payment_transaction_id IS NULL AND
        s.method IN ('צ''ק','מזומן');
    balance:=o.total_price-paid-legacy_paid;
    IF balance<p.amount OR o.archived_at IS NOT NULL OR o.status='בוטל'
    THEN RAISE EXCEPTION 'physical_order_balance_changed' USING ERRCODE='23514'; END IF;
  END IF;
  result:=public.finalize_pelecard_payment(p_payment_id,i.provider_transaction_id,i.approval_id,
    '000',i.amount_minor::numeric/100,'ILS');
  sale:=(result->>'sale_id')::uuid;
  UPDATE public.sales SET method='תשלום במסופון פיזי',
    sale_date=(clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date WHERE id=sale;
  IF p.order_id IS NOT NULL THEN
    UPDATE public.orders SET payment_status=CASE WHEN balance=p.amount
      THEN 'פלאקארד' ELSE 'שולם חלקית' END WHERE id=o.id;
  END IF;
  UPDATE public.physical_payment_intents SET state='succeeded',sale_id=sale,
    updated_at=clock_timestamp() WHERE payment_id=p_payment_id;
  RETURN jsonb_build_object('state','succeeded','paymentId',p_payment_id,
    'orderId',p.order_id,'saleId',sale);
END $$;

CREATE OR REPLACE FUNCTION public.capture_physical_payper_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status='succeeded' AND NEW.sale_id IS NOT NULL AND
    OLD.status IS DISTINCT FROM 'succeeded' AND
    EXISTS(SELECT 1 FROM public.physical_payment_intents WHERE payment_id=NEW.id)
  THEN
    INSERT INTO public.payper_document_ledger(payment_id,order_id,sale_id,state,reconciliation_code)
    VALUES(NEW.id,NEW.order_id,NEW.sale_id,'source_blocked',
      'physical_provider_confirmation_required')
    ON CONFLICT(payment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.get_physical_payment(p_actor_id uuid,p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.physical_payment_intents%ROWTYPE; order_id uuid;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents
    WHERE payment_id=p_payment_id AND created_by=p_actor_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT p.order_id INTO order_id FROM public.payment_transactions p WHERE p.id=i.payment_id;
  RETURN jsonb_build_object('paymentId',i.payment_id,'orderId',order_id,
    'state',i.state,'registerNumber',i.register_number,'amountMinor',i.amount_minor,
    'saleId',i.sale_id,'createdAt',i.created_at);
END $$;

-- Pelecard can issue the automatic Invoice-Receipt at approval, before our
-- subsequent verified_at timestamp. Reconcile the already-issued document
-- against the reservation time, verified payment, sale, amount, and evidence.
-- This RPC only records an existing document; it never calls Payper issuance.
CREATE OR REPLACE FUNCTION public.record_physical_payper_manual_document(
  p_payment_id uuid, p_document_number text, p_document_url text,
  p_issued_at timestamptz, p_amount numeric,
  p_provider_confirmation_ref text, p_accountant_approval_ref text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  l public.payper_document_ledger%ROWTYPE;
  p public.payment_transactions%ROWTYPE;
  s public.sales%ROWTYPE;
  i public.physical_payment_intents%ROWTYPE;
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=actor AND role::text='admin'
  ) THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
  IF p_document_number IS NULL OR p_document_number !~ '^[1-9][0-9]{0,29}$'
    OR p_document_url IS NULL OR
      p_document_url !~ '^https://app\.payper\.co\.il/public/invoice_show/[1-9][0-9]*(\?ak=[A-Za-z0-9_-]{16,128})?$'
    OR p_provider_confirmation_ref IS NULL OR
      p_provider_confirmation_ref !~ '^[A-Za-z0-9:/._-]{8,120}$'
    OR p_accountant_approval_ref IS NULL OR
      p_accountant_approval_ref !~ '^[A-Za-z0-9:/._-]{8,120}$'
  THEN RAISE EXCEPTION 'manual_document_evidence_invalid' USING ERRCODE='23514'; END IF;

  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO p FROM public.payment_transactions WHERE id=p_payment_id;
  SELECT * INTO i FROM public.physical_payment_intents WHERE payment_id=p_payment_id;
  SELECT * INTO s FROM public.sales WHERE id=l.sale_id;
  IF l.payment_id IS NULL OR p.id IS NULL OR i.payment_id IS NULL OR s.id IS NULL
    OR l.state <> 'source_blocked'
    OR l.reconciliation_code <> 'physical_provider_confirmation_required'
    OR l.document_number IS NOT NULL OR l.document_url IS NOT NULL
    OR i.state <> 'succeeded' OR i.sale_id IS DISTINCT FROM s.id
    OR i.provider_transaction_id IS NULL OR i.provider_uid IS NULL
    OR i.provider_transaction_id IS DISTINCT FROM p.provider_transaction_id
    OR p.status <> 'succeeded' OR p.provider <> 'pelecard'
    OR p.operation <> 'payment' OR p.currency <> 'ILS'
    OR p.sale_id IS DISTINCT FROM s.id
    OR p_amount IS NULL OR p.amount IS DISTINCT FROM p_amount
    OR s.total IS DISTINCT FROM p_amount
    OR p_issued_at IS NULL OR p.created_at IS NULL OR p.verified_at IS NULL
    OR p_issued_at < p.created_at OR p_issued_at > clock_timestamp() + interval '5 minutes'
    OR EXISTS (SELECT 1 FROM public.accounting_documents d
      WHERE d.status='succeeded' AND d.source_id IN (p_payment_id::text, s.id::text))
  THEN RAISE EXCEPTION 'physical_manual_document_reconciliation_blocked' USING ERRCODE='23514'; END IF;

  INSERT INTO public.payper_manual_document_audit(
    payment_id, document_number, document_url, issued_at, gross_amount,
    provider_confirmation_ref, accountant_approval_ref, actor_id, previous_reconciliation_code
  ) VALUES (
    p_payment_id, p_document_number, p_document_url, p_issued_at, p_amount,
    p_provider_confirmation_ref, p_accountant_approval_ref, actor, l.reconciliation_code
  );
  UPDATE public.payper_document_ledger
    SET state='succeeded', document_origin='manual',
      source_facts=jsonb_build_object('physicalPaymentId',p_payment_id,
        'providerTransactionId',i.provider_transaction_id,'providerUid',i.provider_uid,
        'providerIssuedAutomatically',true,'reconciledManually',true),
      source_frozen_at=p_issued_at, dispatch_reserved_at=p_issued_at,
      document_number=p_document_number, document_url=p_document_url,
      updated_at=clock_timestamp()
    WHERE payment_id=p_payment_id;
  RETURN true;
END $$;

COMMIT;
