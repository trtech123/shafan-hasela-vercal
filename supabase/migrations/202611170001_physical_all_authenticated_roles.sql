-- Grant the physical payment path to every authenticated application profile.
-- The Vercel API still authenticates the actor; financial gates and register locks remain unchanged.
-- Read-only order status is widened so these roles can see the authoritative balance.
BEGIN;

-- digital_order_payment_issues
CREATE OR REPLACE FUNCTION public.digital_order_payment_issues(p_order_id uuid, p_actor_id uuid, p_billing jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o public.orders%ROWTYPE; c public.customer_snapshots%ROWTYPE;
  issues text[]:=ARRAY[]::text[]; kind text; identity text;
  paid numeric:=0; legacy_paid numeric:=0;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=p_actor_id )
  THEN RAISE EXCEPTION 'order_payment_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id;
  IF NOT FOUND THEN RETURN ARRAY['order_not_found']; END IF;
  IF o.archived_at IS NOT NULL OR o.status IN ('בוטל','שולם') OR
    o.total_price IS NULL OR o.total_price<=0 OR
    o.total_price*100<>trunc(o.total_price*100) OR o.total_price*100>2147483647
  THEN issues:=array_append(issues,'order_not_payable'); END IF;
  SELECT * INTO c FROM public.customer_snapshots WHERE id=o.customer_snapshot_id
    AND order_id=o.id AND customer_id=o.customer_id AND revision=o.customer_record_version;
  IF c.id IS NULL OR jsonb_typeof(c.data->'vat_applicable') IS DISTINCT FROM 'boolean'
    OR o.vat_applicable IS DISTINCT FROM (CASE WHEN jsonb_typeof(c.data->'vat_applicable')='boolean'
      THEN (c.data->>'vat_applicable')::boolean ELSE NULL END)
  THEN issues:=array_append(issues,'vat_required'); END IF;
  IF public.digital_order_service_description(o.id) IS NULL
  THEN issues:=array_append(issues,'invoice_lines_required'); END IF;
  kind:=p_billing->>'kind'; identity:=p_billing->>'identity';
  IF jsonb_typeof(p_billing) IS DISTINCT FROM 'object' OR
    kind NOT IN ('person','organization') OR kind IS NULL OR
    nullif(btrim(p_billing->>'name'),'') IS NULL OR length(p_billing->>'name')>200 OR
    p_billing->>'name' ~ '[[:cntrl:]]' OR
    identity IS NULL OR identity !~ '^[0-9]{9}$' OR identity='000000000' OR
    (kind='person' AND NOT public.payper_valid_person_identity(identity))
  THEN issues:=array_append(issues,'billing_identity_required'); END IF;
  -- The current Payper ledger and continuous dispatch require a deliverable email.
  IF nullif(btrim(p_billing->>'email'),'') IS NULL OR length(p_billing->>'email')>320 OR
    p_billing->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN issues:=array_append(issues,'billing_email_required'); END IF;
  IF EXISTS(SELECT 1 FROM public.accounting_documents d WHERE d.status<>'permanent_error' AND
      ((d.source_type='order' AND d.source_id=o.id::text) OR
       (d.source_type='sale' AND EXISTS(SELECT 1 FROM public.sales s
         WHERE s.order_id=o.id AND s.id::text=d.source_id)) OR
       (d.source_type='payment_transaction' AND EXISTS(SELECT 1 FROM public.payment_transactions p
         WHERE p.order_id=o.id AND p.id::text=d.source_id)))) OR
    EXISTS(SELECT 1 FROM public.payper_document_ledger l WHERE l.order_id=o.id
      AND l.state IN ('dispatch_reserved','reconciliation_required','succeeded'))
  THEN issues:=array_append(issues,'accounting_review_required'); END IF;
  SELECT coalesce(sum(CASE WHEN operation='refund' AND status='refunded' THEN -amount
    WHEN operation='payment' AND status='succeeded' THEN amount ELSE 0 END),0)
    INTO paid FROM public.payment_transactions WHERE order_id=o.id;
  SELECT coalesce(sum(total),0) INTO legacy_paid FROM public.sales WHERE order_id=o.id
    AND payment_transaction_id IS NULL AND method IN ('צ''ק','מזומן');
  IF paid+legacy_paid<>0 OR o.payment_status IS DISTINCT FROM 'לא שולם' OR
    EXISTS(SELECT 1 FROM public.payper_noncard_payments WHERE order_id=o.id) OR
    EXISTS(SELECT 1 FROM public.sales WHERE order_id IS NULL AND linked_order_info->>'order_number'=o.order_number) OR
    EXISTS(SELECT 1 FROM public.payment_transactions WHERE order_id IS NULL AND
      checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
  THEN issues:=array_append(issues,'digital_partial_unsupported'); END IF;
  RETURN issues;
END $function$;

-- get_payper_billing_defaults
CREATE OR REPLACE FUNCTION public.get_payper_billing_defaults(p_order_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o public.orders%ROWTYPE; c public.customer_snapshots%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id )
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
END $function$;

-- get_payper_order_collection
CREATE OR REPLACE FUNCTION public.get_payper_order_collection(p_actor_id uuid, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o public.orders%ROWTYPE; paid numeric:=0; legacy_paid numeric:=0;
  activity_name text; documents jsonb; payments jsonb; unresolved boolean;
  document_review boolean;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=p_actor_id )
  THEN RAISE EXCEPTION 'order_collection_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  SELECT name INTO activity_name FROM public.activities WHERE id=o.activity_id;
  SELECT coalesce(pg_catalog.sum(CASE WHEN p.operation='refund' AND p.status='refunded'
    THEN -p.amount WHEN p.operation='payment' AND p.status='succeeded'
    THEN p.amount ELSE 0 END),0),
    coalesce(pg_catalog.bool_or(p.operation='payment' AND
      p.status IN ('initiated','pending_provider','timed_out')),false)
    INTO paid,unresolved FROM public.payment_transactions p WHERE p.order_id=o.id;
  SELECT coalesce(pg_catalog.sum(s.total),0) INTO legacy_paid FROM public.sales s
    WHERE s.order_id=o.id AND s.payment_transaction_id IS NULL AND
      s.method IN ('צ''ק','מזומן');
  paid:=paid+legacy_paid;
  IF EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id IS NULL AND
    s.linked_order_info->>'order_number'=o.order_number)
    OR EXISTS(SELECT 1 FROM public.payment_transactions p WHERE p.order_id IS NULL AND
      p.checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
  THEN unresolved:=true; END IF;
  IF (o.payment_status IS NULL OR o.payment_status NOT IN ('לא שולם','שולם חלקית')) AND paid<o.total_price THEN
    unresolved:=true; END IF;
  IF (o.payment_status='לא שולם' AND paid>0) OR
    (o.payment_status='שולם חלקית' AND paid<=0) THEN unresolved:=true; END IF;
  SELECT EXISTS(SELECT 1 FROM public.accounting_documents d
      WHERE d.status<>'permanent_error' AND
        ((d.source_type='order' AND d.source_id=o.id::text) OR
         (d.source_type='sale' AND EXISTS(SELECT 1 FROM public.sales s
           WHERE s.order_id=o.id AND s.id::text=d.source_id)) OR
         (d.source_type='payment_transaction' AND EXISTS
           (SELECT 1 FROM public.payment_transactions p
             WHERE p.order_id=o.id AND p.id::text=d.source_id))))
    OR EXISTS(SELECT 1 FROM public.payper_document_ledger l WHERE l.order_id=o.id
      AND l.state IN ('dispatch_reserved','reconciliation_required','succeeded'))
    INTO document_review;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',p.id,'amountMinor',(p.amount*100)::integer,'provider',p.provider,
    'status',p.status,'clearanceStatus',n.clearance_status,'createdAt',p.created_at)
    ORDER BY p.created_at),'[]'::jsonb)
    INTO payments FROM public.payment_transactions p
    LEFT JOIN public.payper_noncard_payments n ON n.payment_id=p.id
    WHERE p.order_id=o.id;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'paymentId',l.payment_id,'state',l.state,'documentNumber',l.document_number,
    'documentUrl',l.document_url,'code',l.reconciliation_code) ORDER BY l.created_at),'[]'::jsonb)
    INTO documents FROM public.payper_document_ledger l WHERE l.order_id=o.id;
  RETURN pg_catalog.jsonb_build_object('orderId',o.id,'orderNumber',o.order_number,
    'clientName',o.client_name,'organization',o.organization,'activityName',activity_name,
    'activityDate',o.activity_date,'participants',o.num_participants,
    'pricePerPerson',o.price_per_person,'quoteId',o.quote_id,
    'totalMinor',(o.total_price*100)::integer,'paidMinor',(paid*100)::integer,
    'balanceMinor',((o.total_price-paid)*100)::integer,'unresolvedPayment',unresolved,
    'accountingReviewRequired',document_review,
    'billing',pg_catalog.jsonb_build_object('kind',CASE WHEN nullif(o.organization,'') IS NULL THEN 'person' ELSE 'organization' END,
      'name',coalesce(o.billing_institution_name,o.organization,o.client_name),
      'identity',o.billing_company_id,'email',coalesce(o.billing_accounting_email,o.client_email)),
    'payments',payments,'documents',documents);
END $function$;

-- reserve_physical_order_payment
CREATE OR REPLACE FUNCTION public.reserve_physical_order_payment(p_actor_id uuid, p_request_key uuid, p_workstation_code text, p_order_id uuid, p_amount_minor integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  o public.orders%ROWTYPE; d public.physical_terminal_devices%ROWTYPE;
  i public.physical_payment_intents%ROWTYPE; p public.payment_transactions%ROWTYPE;
  paid numeric:=0; legacy_paid numeric:=0; balance numeric; amount numeric;
  billing jsonb; snapshot jsonb; payment_id uuid; activity_name text;
  customer_kind text; quote_discount numeric;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id )
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
    (EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text<>'admin')
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
END $function$;

-- reserve_physical_payment
CREATE OR REPLACE FUNCTION public.reserve_physical_payment(p_actor_id uuid, p_request_key uuid, p_workstation_code text, p_amount_minor integer, p_checkout_snapshot jsonb, p_billing_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE i public.physical_payment_intents%ROWTYPE; d public.physical_terminal_devices%ROWTYPE;
  payment_id uuid; role_name text; total numeric; subtotal numeric:=0; line jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT role::text INTO role_name FROM public.profiles WHERE id=p_actor_id;
  IF role_name IS NULL OR p_request_key IS NULL OR
    p_workstation_code IS NULL OR p_amount_minor NOT BETWEEN 1 AND 2147483647 OR
    jsonb_typeof(p_checkout_snapshot->'items')<>'array' OR
    jsonb_array_length(p_checkout_snapshot->'items') NOT BETWEEN 1 AND 100 OR
    jsonb_typeof(p_billing_snapshot)<>'object'
  THEN RAISE EXCEPTION 'physical_reservation_invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO i FROM public.physical_payment_intents WHERE request_key=p_request_key;
  IF FOUND THEN
    IF i.created_by IS DISTINCT FROM p_actor_id OR i.workstation_code IS DISTINCT FROM p_workstation_code OR
      i.amount_minor IS DISTINCT FROM p_amount_minor OR i.checkout_snapshot IS DISTINCT FROM p_checkout_snapshot
    THEN RAISE EXCEPTION 'physical_request_conflict' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('paymentId',i.payment_id,'state',i.state,'registerNumber',i.register_number);
  END IF;
  SELECT * INTO d FROM public.physical_terminal_devices
    WHERE cash_register_code=p_workstation_code AND enabled FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.cash_registers
      WHERE code=p_workstation_code AND active)
  THEN RAISE EXCEPTION 'physical_register_unassigned' USING ERRCODE='23514'; END IF;
  -- The trusted server reprices each catalog row. Recheck frozen arithmetic in
  -- the reservation transaction before this amount can ever be dispatched.
  FOR line IN SELECT value FROM jsonb_array_elements(p_checkout_snapshot->'items') LOOP
    IF jsonb_typeof(line)<>'object' OR line->>'qty' !~ '^[1-9][0-9]{0,3}$' OR
      (line->>'qty')::integer>1000 OR
      line->>'customPrice' !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' OR
      (line->>'customPrice')::numeric<=0 OR nullif(btrim(line->>'name'),'') IS NULL
    THEN RAISE EXCEPTION 'physical_snapshot_invalid' USING ERRCODE='23514'; END IF;
    subtotal:=subtotal+(line->>'qty')::integer*(line->>'customPrice')::numeric;
  END LOOP;
  total:=p_amount_minor::numeric/100;
  IF p_checkout_snapshot->'discount' IS NULL OR p_checkout_snapshot->'discount'='null'::jsonb THEN
    IF subtotal IS DISTINCT FROM total THEN RAISE EXCEPTION 'physical_amount_mismatch' USING ERRCODE='23514'; END IF;
  ELSIF jsonb_typeof(p_checkout_snapshot->'discount')<>'object' OR
    jsonb_typeof(p_checkout_snapshot->'discount'->'original_total')<>'number' OR
    jsonb_typeof(p_checkout_snapshot->'discount'->'final_total')<>'number' OR
    (p_checkout_snapshot->'discount'->>'original_total')::numeric IS DISTINCT FROM subtotal OR
    (p_checkout_snapshot->'discount'->>'final_total')::numeric IS DISTINCT FROM total OR
    total>=subtotal
  THEN RAISE EXCEPTION 'physical_amount_mismatch' USING ERRCODE='23514'; END IF;
  payment_id:=gen_random_uuid();
  INSERT INTO public.payment_transactions(id,provider,operation,order_id,amount,currency,status,
    idempotency_key,checkout_snapshot,created_by)
  VALUES(payment_id,'pelecard','payment',NULL,total,'ILS','initiated',
    'physical-'||payment_id::text,p_checkout_snapshot,p_actor_id);
  INSERT INTO public.physical_payment_intents(payment_id,request_key,created_by,workstation_code,
    register_number,terminal_number,amount_minor,checkout_snapshot,billing_snapshot)
  VALUES(payment_id,p_request_key,p_actor_id,p_workstation_code,d.register_number,
    '2814926015',p_amount_minor,p_checkout_snapshot,p_billing_snapshot);
  INSERT INTO public.payper_payment_billing_snapshots(payment_id,order_id,customer_kind,
    billing_name,billing_identity,billing_email,vat_applicable)
  VALUES(payment_id,NULL,p_billing_snapshot->>'kind',p_billing_snapshot->>'name',
    p_billing_snapshot->>'identity',p_billing_snapshot->>'email',true);
  RETURN jsonb_build_object('paymentId',payment_id,'state','reserved','registerNumber',d.register_number);
END $function$;

COMMIT;
