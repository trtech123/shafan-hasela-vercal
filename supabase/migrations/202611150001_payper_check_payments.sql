-- Check receipts are a separate non-card source. This migration does not change
-- the Pelecard dispatch control, activation epoch, or digital worker selection.
BEGIN;

ALTER TABLE public.payment_transactions DROP CONSTRAINT payment_transactions_provider_check;
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_provider_check
  CHECK (provider IN ('pelecard', 'manual_check', 'manual_cash'));

CREATE TABLE public.payper_noncard_payments (
  payment_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  sale_id uuid NOT NULL UNIQUE REFERENCES public.sales(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES public.orders(id) ON DELETE RESTRICT,
  request_key uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  method text NOT NULL CHECK (method IN ('check','cash')),
  clearance_status text NOT NULL CHECK (clearance_status IN ('received_uncleared','not_applicable')),
  document_type text NOT NULL CHECK (document_type IN ('invoice-receipt','receipt')),
  reference_document_id text,
  check_details jsonb,
  billing jsonb NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((method='cash' AND clearance_status='not_applicable' AND check_details IS NULL)
    OR (method='check' AND clearance_status='received_uncleared' AND check_details IS NOT NULL))
);
-- One order may have several legitimate partial payments and documents.
DROP INDEX public.payper_document_ledger_order_unique;
ALTER TABLE public.payper_document_ledger ALTER COLUMN order_id DROP NOT NULL;
-- A non-card document has no Pelecard transaction record. Keep the record-ID
-- fence for digital dispatch and the existing manual physical exception.
ALTER TABLE public.payper_document_ledger DROP CONSTRAINT payper_reserved_requires_trx_record;
ALTER TABLE public.payper_document_ledger ADD CONSTRAINT payper_reserved_requires_trx_record CHECK (
  state NOT IN ('dispatch_reserved','reconciliation_required','succeeded')
  OR provider_trx_record_id IS NOT NULL
  OR (state='succeeded' AND document_origin='manual')
  OR source_facts->>'sourceType' IN ('manual_check','manual_cash')
);
ALTER TABLE public.orders DROP CONSTRAINT orders_payment_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check CHECK (
  payment_status IN ('לא שולם','שובר','אשראי','צ''ק','מזומן','פלאקארד','שולם חלקית'));

-- The existing hosted checkout charges the full saved order total. Until it
-- accepts a server-computed balance, reject a new hosted attempt after a
-- non-card partial collection, before any Pelecard call can be initiated.
CREATE FUNCTION public.guard_hosted_after_noncard_partial() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.provider='pelecard' AND NEW.operation='payment' AND NEW.order_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.payper_noncard_payments n WHERE n.order_id=NEW.order_id)
  THEN RAISE EXCEPTION 'hosted_partial_balance_unsupported' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_hosted_after_noncard_partial BEFORE INSERT ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_hosted_after_noncard_partial();
REVOKE ALL ON FUNCTION public.guard_hosted_after_noncard_partial() FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.payper_noncard_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payper_noncard_payments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.payper_noncard_payments TO service_role;

-- The sale, non-card payment, durable Payper obligation and accounting event
-- commit together. Reusing a request key only returns the original sale.
CREATE FUNCTION public.record_payper_noncard_sale(
  p_actor_id uuid, p_request_key uuid, p_method text, p_lines jsonb, p_discount jsonb,
  p_check jsonb, p_billing jsonb, p_document_type text,
  p_reference_document_id text, p_expected_minor integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  role_name text; existing public.payper_noncard_payments%ROWTYPE;
  line jsonb; item_id uuid; kind text; qty integer; item_name text;
  unit_price numeric; subtotal numeric:=0; deduction numeric:=0; total numeric;
  frozen jsonb:='[]'::jsonb; discount_snapshot jsonb; sale_id uuid;
  payment_id uuid; receipt_number text; due_date date; received_date date;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT role::text INTO role_name FROM public.profiles WHERE id=p_actor_id;
  IF role_name NOT IN ('admin','cashier') OR p_request_key IS NULL THEN
    RAISE EXCEPTION 'check_sale_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO existing FROM public.payper_noncard_payments WHERE request_key=p_request_key;
  IF FOUND THEN
    IF existing.actor_id IS DISTINCT FROM p_actor_id OR existing.method IS DISTINCT FROM p_method
      OR existing.amount_minor IS DISTINCT FROM p_expected_minor
    THEN RAISE EXCEPTION 'request_key_conflict'; END IF;
    RETURN pg_catalog.jsonb_build_object('paymentId',existing.payment_id,'saleId',existing.sale_id,
      'receiptNumber',(SELECT s.receipt_number FROM public.sales s WHERE s.id=existing.sale_id),'created',false);
  END IF;
  IF p_method NOT IN ('check','cash') OR p_document_type IS DISTINCT FROM 'invoice-receipt'
    OR p_reference_document_id IS NOT NULL THEN
    RAISE EXCEPTION 'check_document_type_invalid'; END IF;
  IF pg_catalog.jsonb_typeof(p_billing)<>'object' OR
    coalesce(p_billing->>'kind','') NOT IN ('person','organization') OR
    pg_catalog.length(pg_catalog.btrim(coalesce(p_billing->>'name',''))) NOT BETWEEN 1 AND 200 OR
    coalesce(p_billing->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR
    pg_catalog.length(p_billing->>'email')>320 OR
    coalesce(p_billing->>'identity','') !~ '^[0-9]{9}$' OR
    (p_billing->>'kind'='person' AND NOT public.payper_valid_person_identity(p_billing->>'identity')) THEN
    RAISE EXCEPTION 'check_billing_invalid'; END IF;
  IF p_method='check' THEN
    IF pg_catalog.jsonb_typeof(p_check)<>'object' OR
    coalesce(p_check->>'check_number','') !~ '^[0-9]{1,20}$' OR
    pg_catalog.length(pg_catalog.btrim(coalesce(p_check->>'bank',''))) NOT BETWEEN 1 AND 100 OR
    coalesce(p_check->>'branch','') !~ '^[0-9]{1,8}$' OR
    coalesce(p_check->>'account_number','') !~ '^[0-9]{1,20}$' OR
    pg_catalog.length(pg_catalog.btrim(coalesce(p_check->>'account_holder',''))) NOT BETWEEN 1 AND 200 OR
    coalesce(p_check->>'received_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR
    coalesce(p_check->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR
    coalesce(p_check->>'amount','') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'check_details_invalid'; END IF;
    received_date:=(p_check->>'received_date')::date;
    due_date:=(p_check->>'due_date')::date;
    IF received_date>(pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date OR
      due_date<received_date THEN RAISE EXCEPTION 'check_dates_invalid'; END IF;
  ELSE
    IF p_check IS NOT NULL AND p_check<>'null'::jsonb THEN RAISE EXCEPTION 'cash_check_details_forbidden'; END IF;
    received_date:=(pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date;
  END IF;
  IF pg_catalog.jsonb_typeof(p_lines)<>'array' OR
    pg_catalog.jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'cart_invalid'; END IF;
  FOR line IN SELECT value FROM pg_catalog.jsonb_array_elements(p_lines) LOOP
    IF pg_catalog.jsonb_typeof(line)<>'object' OR
      line->>'kind' NOT IN ('service','product') OR
      coalesce(line->>'id','') !~ '^[0-9a-fA-F-]{36}$' OR
      coalesce(line->>'qty','') !~ '^[1-9][0-9]{0,3}$' THEN
      RAISE EXCEPTION 'cart_line_invalid'; END IF;
    item_id:=(line->>'id')::uuid; kind:=line->>'kind'; qty:=(line->>'qty')::integer;
    IF qty>1000 OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(frozen) prior
      WHERE prior.value->>'id'=item_id::text) THEN RAISE EXCEPTION 'cart_line_invalid'; END IF;
    IF kind='product' THEN
      SELECT nullif(pg_catalog.btrim(name),''),price INTO item_name,unit_price
        FROM public.products WHERE id=item_id AND status='פעיל' FOR SHARE;
    ELSE
      SELECT nullif(pg_catalog.btrim(name),''),price_per_person INTO item_name,unit_price
        FROM public.activities WHERE id=item_id AND status='פעיל' FOR SHARE;
    END IF;
    IF item_name IS NULL OR pg_catalog.length(item_name)>200 OR unit_price IS NULL OR
      unit_price<=0 OR unit_price*100<>pg_catalog.trunc(unit_price*100) THEN
      RAISE EXCEPTION 'catalog_item_unavailable'; END IF;
    subtotal:=subtotal+unit_price*qty;
    IF subtotal*100>2147483647 THEN RAISE EXCEPTION 'cart_amount_invalid'; END IF;
    frozen:=frozen||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id',item_id::text,'name',item_name,'qty',qty,'customPrice',unit_price));
  END LOOP;
  IF p_discount IS NOT NULL AND p_discount<>'null'::jsonb THEN
    IF role_name<>'admin' OR p_discount->>'mode' NOT IN ('fixed','percentage') OR
      p_discount->>'type' NOT IN ('הנחת עובד','הנחת נכה','הנחה כללית') OR
      coalesce(p_discount->>'value','') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'discount_invalid'; END IF;
    IF p_discount->>'mode'='fixed' THEN deduction:=(p_discount->>'value')::numeric;
    ELSE
      IF (p_discount->>'value')::numeric>100 THEN RAISE EXCEPTION 'discount_invalid'; END IF;
      deduction:=pg_catalog.round(subtotal*(p_discount->>'value')::numeric/100,2);
    END IF;
    IF deduction<=0 THEN RAISE EXCEPTION 'discount_invalid'; END IF;
    discount_snapshot:=p_discount||pg_catalog.jsonb_build_object('original_total',subtotal,'final_total',subtotal-deduction);
  END IF;
  total:=subtotal-deduction;
  IF total<=0 OR total*100>2147483647 OR (total*100)::integer IS DISTINCT FROM p_expected_minor
    THEN RAISE EXCEPTION 'sale_amount_mismatch'; END IF;
  IF p_method='check' AND (p_check->>'amount')::numeric<>total
    THEN RAISE EXCEPTION 'check_amount_mismatch'; END IF;
  INSERT INTO public.sales(items,total,method,payment_details,discount,sale_date,created_by)
    VALUES(frozen,total,CASE WHEN p_method='check' THEN 'צ''ק' ELSE 'מזומן' END,
      p_check,discount_snapshot,received_date,p_actor_id)
    RETURNING id,sales.receipt_number INTO sale_id,receipt_number;
  payment_id:=pg_catalog.gen_random_uuid();
  INSERT INTO public.payment_transactions(id,provider,operation,sale_id,amount,currency,status,
    idempotency_key,checkout_snapshot,created_by)
    VALUES(payment_id,CASE WHEN p_method='check' THEN 'manual_check' ELSE 'manual_cash' END,
      'payment',sale_id,total,'ILS','succeeded',
      'noncard-'||p_request_key::text,pg_catalog.jsonb_build_object('schema_version',1,'items',frozen,
      'discount',discount_snapshot,'sale_date',received_date::text),p_actor_id);
  UPDATE public.sales SET payment_transaction_id=payment_id WHERE id=sale_id;
  INSERT INTO public.payper_noncard_payments(payment_id,sale_id,request_key,actor_id,method,clearance_status,document_type,
    reference_document_id,check_details,billing,amount_minor)
    VALUES(payment_id,sale_id,p_request_key,p_actor_id,p_method,
      CASE WHEN p_method='check' THEN 'received_uncleared' ELSE 'not_applicable' END,p_document_type,p_reference_document_id,
      p_check,p_billing,(total*100)::integer);
  INSERT INTO public.payper_document_ledger(payment_id,order_id,sale_id,state,source_facts,source_frozen_at)
    VALUES(payment_id,NULL,sale_id,'source_frozen',pg_catalog.jsonb_build_object(
      'sourceType',CASE WHEN p_method='check' THEN 'manual_check' ELSE 'manual_cash' END,
      'saleId',sale_id,'paymentId',payment_id,'amountMinor',(total*100)::integer,
      'items',frozen,'discount',discount_snapshot,'vatApplicable',true,
      'documentType',p_document_type,'referenceDocumentId',p_reference_document_id),pg_catalog.clock_timestamp());
  INSERT INTO public.accounting_events(source_type,source_id,purpose,accounting_provider,status)
    VALUES('payment_transaction',payment_id::text,'noncard_payment','payper','pending');
  RETURN pg_catalog.jsonb_build_object('paymentId',payment_id,'saleId',sale_id,
    'receiptNumber',receipt_number,'created',true);
END $$;
REVOKE ALL ON FUNCTION public.record_payper_noncard_sale(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_payper_noncard_sale(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text,integer)
  TO service_role;

-- Schedule collection uses the saved order total and already recorded money.
-- An admin may collect a partial amount; a cashier may collect only the balance.
CREATE FUNCTION public.record_payper_order_collection(
  p_actor_id uuid,p_request_key uuid,p_order_id uuid,p_method text,p_amount_minor integer,
  p_check jsonb,p_billing jsonb,p_document_type text,p_reference_document_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  role_name text; o public.orders%ROWTYPE; existing public.payper_noncard_payments%ROWTYPE;
  paid numeric:=0; legacy_paid numeric:=0; balance numeric; amount numeric;
  activity_name text; sale_id uuid; payment_id uuid; receipt_number text;
  frozen jsonb; received_date date; due_date date; document_review boolean:=false;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT role::text INTO role_name FROM public.profiles WHERE id=p_actor_id;
  IF role_name NOT IN ('admin','cashier') OR p_request_key IS NULL THEN
    RAISE EXCEPTION 'order_collection_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO existing FROM public.payper_noncard_payments WHERE request_key=p_request_key;
  IF FOUND THEN
    IF existing.actor_id IS DISTINCT FROM p_actor_id OR existing.order_id IS DISTINCT FROM p_order_id
      OR existing.method IS DISTINCT FROM p_method OR existing.amount_minor IS DISTINCT FROM p_amount_minor
    THEN RAISE EXCEPTION 'request_key_conflict'; END IF;
    RETURN pg_catalog.jsonb_build_object('paymentId',existing.payment_id,'saleId',existing.sale_id,
      'receiptNumber',(SELECT s.receipt_number FROM public.sales s WHERE s.id=existing.sale_id),'created',false);
  END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR o.archived_at IS NOT NULL OR o.status='בוטל' OR o.total_price IS NULL OR
    o.total_price<=0 OR o.total_price*100<>pg_catalog.trunc(o.total_price*100) OR
    p_method NOT IN ('check','cash') OR p_amount_minor IS NULL OR p_amount_minor<=0
  THEN RAISE EXCEPTION 'order_collection_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM public.payment_transactions p WHERE p.order_id=o.id
    AND p.operation='payment' AND p.status IN ('initiated','pending_provider','timed_out'))
  THEN RAISE EXCEPTION 'order_payment_unresolved'; END IF;
  IF EXISTS(SELECT 1 FROM public.sales s WHERE s.order_id IS NULL AND
    s.linked_order_info->>'order_number'=o.order_number)
    OR EXISTS(SELECT 1 FROM public.payment_transactions p WHERE p.order_id IS NULL AND
      p.checkout_snapshot->'linked_order_info'->>'order_number'=o.order_number)
  THEN RAISE EXCEPTION 'legacy_order_payment_review_required'; END IF;
  SELECT coalesce(pg_catalog.sum(CASE WHEN p.operation='refund' AND p.status='refunded'
      THEN -p.amount WHEN p.operation='payment' AND p.status='succeeded'
      THEN p.amount ELSE 0 END),0) INTO paid
    FROM public.payment_transactions p WHERE p.order_id=o.id;
  SELECT coalesce(pg_catalog.sum(s.total),0) INTO legacy_paid FROM public.sales s
    WHERE s.order_id=o.id AND s.payment_transaction_id IS NULL AND
      s.method IN ('צ''ק','מזומן');
  paid:=paid+legacy_paid;
  balance:=o.total_price-paid; amount:=p_amount_minor::numeric/100;
  IF o.payment_status IS NULL OR o.payment_status NOT IN ('לא שולם','שולם חלקית') OR
    (o.payment_status='לא שולם' AND paid>0) OR
    (o.payment_status='שולם חלקית' AND paid<=0) OR
    balance<=0 OR amount<>balance OR amount*100<>p_amount_minor
  THEN RAISE EXCEPTION 'order_balance_mismatch'; END IF;
  IF p_document_type IS DISTINCT FROM 'invoice-receipt' OR p_reference_document_id IS NOT NULL THEN
    RAISE EXCEPTION 'check_document_type_invalid'; END IF;
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
  IF pg_catalog.jsonb_typeof(p_billing)<>'object' OR
    coalesce(p_billing->>'kind','') NOT IN ('person','organization') OR
    pg_catalog.length(pg_catalog.btrim(coalesce(p_billing->>'name',''))) NOT BETWEEN 1 AND 200 OR
    coalesce(p_billing->>'identity','') !~ '^[0-9]{9}$' OR
    (p_billing->>'kind'='person' AND NOT public.payper_valid_person_identity(p_billing->>'identity')) OR
    coalesce(p_billing->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN RAISE EXCEPTION 'check_billing_invalid'; END IF;
  IF p_method='check' THEN
    IF pg_catalog.jsonb_typeof(p_check)<>'object' OR
      coalesce(p_check->>'check_number','') !~ '^[0-9]{1,20}$' OR
      pg_catalog.length(pg_catalog.btrim(coalesce(p_check->>'bank',''))) NOT BETWEEN 1 AND 100 OR
      coalesce(p_check->>'branch','') !~ '^[0-9]{1,8}$' OR
      coalesce(p_check->>'account_number','') !~ '^[0-9]{1,20}$' OR
      pg_catalog.length(pg_catalog.btrim(coalesce(p_check->>'account_holder',''))) NOT BETWEEN 1 AND 200 OR
      coalesce(p_check->>'received_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR
      coalesce(p_check->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR
      coalesce(p_check->>'amount','') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$'
    THEN RAISE EXCEPTION 'check_details_invalid'; END IF;
    IF (p_check->>'amount')::numeric IS DISTINCT FROM amount
    THEN RAISE EXCEPTION 'check_amount_mismatch'; END IF;
    received_date:=(p_check->>'received_date')::date;
    due_date:=(p_check->>'due_date')::date;
    IF received_date>(pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date OR
      due_date<received_date THEN RAISE EXCEPTION 'check_dates_invalid'; END IF;
  ELSE
    IF p_check IS NOT NULL AND p_check<>'null'::jsonb THEN RAISE EXCEPTION 'cash_check_details_forbidden'; END IF;
    received_date:=(pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date;
  END IF;
  SELECT name INTO activity_name FROM public.activities WHERE id=o.activity_id;
  activity_name:=coalesce(nullif(pg_catalog.btrim(activity_name),''),'פעילות קבוצתית');
  frozen:=pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',o.id::text,
    'name',activity_name||' — '||o.order_number,'qty',1,'customPrice',amount));
  INSERT INTO public.sales(items,total,method,payment_details,order_id,linked_order_info,sale_date,created_by)
    VALUES(frozen,amount,CASE WHEN p_method='check' THEN 'צ''ק' ELSE 'מזומן' END,
      p_check,o.id,pg_catalog.jsonb_build_object('order_number',o.order_number,
      'client_name',o.client_name,'organization',o.organization),received_date,p_actor_id)
    RETURNING id,sales.receipt_number INTO sale_id,receipt_number;
  payment_id:=pg_catalog.gen_random_uuid();
  INSERT INTO public.payment_transactions(id,provider,operation,order_id,sale_id,amount,currency,
    status,idempotency_key,checkout_snapshot,created_by)
    VALUES(payment_id,CASE WHEN p_method='check' THEN 'manual_check' ELSE 'manual_cash' END,
      'payment',o.id,sale_id,amount,'ILS','succeeded','noncard-'||p_request_key::text,
      pg_catalog.jsonb_build_object('schema_version',1,'items',frozen,'discount',NULL,
      'sale_date',received_date::text),p_actor_id);
  UPDATE public.sales SET payment_transaction_id=payment_id WHERE id=sale_id;
  INSERT INTO public.payper_noncard_payments(payment_id,sale_id,order_id,request_key,actor_id,method,clearance_status,
    document_type,reference_document_id,check_details,billing,amount_minor)
    VALUES(payment_id,sale_id,o.id,p_request_key,p_actor_id,p_method,
      CASE WHEN p_method='check' THEN 'received_uncleared' ELSE 'not_applicable' END,p_document_type,
      p_reference_document_id,p_check,p_billing,p_amount_minor);
  INSERT INTO public.payper_document_ledger(payment_id,order_id,sale_id,state,reconciliation_code,source_facts,source_frozen_at)
    VALUES(payment_id,o.id,sale_id,CASE WHEN document_review THEN 'source_blocked' ELSE 'source_frozen' END,
      CASE WHEN document_review THEN 'existing_document_review_required' ELSE NULL END,pg_catalog.jsonb_build_object(
      'sourceType',CASE WHEN p_method='check' THEN 'manual_check' ELSE 'manual_cash' END,
      'saleId',sale_id,'orderId',o.id,'paymentId',payment_id,'amountMinor',p_amount_minor,
      'items',frozen,'vatApplicable',true,'documentType',p_document_type,
      'referenceDocumentId',p_reference_document_id),pg_catalog.clock_timestamp());
  INSERT INTO public.accounting_events(source_type,source_id,purpose,accounting_provider,status)
    VALUES('payment_transaction',payment_id::text,'noncard_payment','payper',
      CASE WHEN document_review THEN 'configuration_required' ELSE 'pending' END);
  UPDATE public.orders SET payment_status=CASE WHEN p_method='check' THEN 'צ''ק' ELSE 'מזומן' END
    WHERE id=o.id;
  RETURN pg_catalog.jsonb_build_object('paymentId',payment_id,'saleId',sale_id,
    'receiptNumber',receipt_number,'created',true,'orderId',o.id,
    'paidMinor',((paid+amount)*100)::integer,'balanceMinor',((balance-amount)*100)::integer);
END $$;
REVOKE ALL ON FUNCTION public.record_payper_order_collection(uuid,uuid,uuid,text,integer,jsonb,jsonb,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_payper_order_collection(uuid,uuid,uuid,text,integer,jsonb,jsonb,text,text)
  TO service_role;

CREATE FUNCTION public.get_payper_order_collection(p_actor_id uuid,p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; paid numeric:=0; legacy_paid numeric:=0;
  activity_name text; documents jsonb; payments jsonb; unresolved boolean;
  document_review boolean;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text IN ('admin','cashier'))
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
END $$;
REVOKE ALL ON FUNCTION public.get_payper_order_collection(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_payper_order_collection(uuid,uuid) TO service_role;

CREATE FUNCTION public.reserve_check_payper_dispatch(p_payment_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.payper_document_ledger%ROWTYPE; c public.payper_noncard_payments%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
  SELECT * INTO c FROM public.payper_noncard_payments WHERE payment_id=p_payment_id;
  IF c.payment_id IS NULL OR l.state<>'source_frozen' OR l.sale_id IS DISTINCT FROM c.sale_id OR
    EXISTS(SELECT 1 FROM public.accounting_documents d
      WHERE d.source_id IN (c.sale_id::text,c.payment_id::text) AND d.status IN ('processing','succeeded','reconciliation_required'))
  THEN RAISE EXCEPTION 'check_payper_dispatch_fence'; END IF;
  UPDATE public.payper_document_ledger SET state='dispatch_reserved',
    dispatch_reserved_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
    WHERE payment_id=p_payment_id;
  RETURN l.id;
END $$;
REVOKE ALL ON FUNCTION public.reserve_check_payper_dispatch(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_check_payper_dispatch(uuid) TO service_role;

CREATE FUNCTION public.record_check_payper_outcome(p_payment_id uuid,p_state text,
  p_document_number text,p_document_url text,p_code text,p_response_received boolean,
  p_provider_status_code text,p_invoice_status text,p_invoice_error text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result text;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.payper_noncard_payments WHERE payment_id=p_payment_id)
  THEN RAISE EXCEPTION 'check_payment_required' USING ERRCODE='42501'; END IF;
  result:=public.record_payper_dispatch_outcome_v2(p_payment_id,p_state,p_document_number,
    p_document_url,p_code,p_response_received,p_provider_status_code,p_invoice_status,p_invoice_error);
  UPDATE public.accounting_events SET status=CASE WHEN result='succeeded' THEN 'succeeded'
    ELSE 'reconciliation_required' END,updated_at=pg_catalog.clock_timestamp()
    WHERE source_type='payment_transaction' AND source_id=p_payment_id::text
      AND purpose IN ('check_payment','noncard_payment') AND accounting_provider='payper';
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_check_payper_outcome(uuid,text,text,text,text,boolean,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_check_payper_outcome(uuid,text,text,text,text,boolean,text,text,text)
  TO service_role;

COMMIT;
