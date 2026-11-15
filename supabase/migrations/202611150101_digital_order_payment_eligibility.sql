-- Require an invoice-ready source before an order-linked hosted charge.
-- No provider or dispatch configuration is changed by this migration.
BEGIN;

CREATE FUNCTION public.digital_order_service_description(p_order_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; description text; activity_name text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id=p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF o.quote_id IS NOT NULL THEN
    IF jsonb_typeof(o.quotation_snapshot) IS DISTINCT FROM 'object' OR
      jsonb_typeof(o.quotation_snapshot->'final_price') IS DISTINCT FROM 'number' OR
      jsonb_typeof(o.quotation_snapshot->'selected_activities') IS DISTINCT FROM 'array'
    THEN RETURN NULL; END IF;
    IF (o.quotation_snapshot->>'final_price')::numeric IS DISTINCT FROM o.total_price OR
      jsonb_array_length(o.quotation_snapshot->'selected_activities') NOT BETWEEN 1 AND 100 OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(o.quotation_snapshot->'selected_activities') item
        WHERE nullif(btrim(item.value->>'activity_name'),'') IS NULL)
    THEN RETURN NULL; END IF;
    SELECT string_agg(btrim(item.value->>'activity_name'),', ' ORDER BY item.ordinality)
      INTO activity_name FROM jsonb_array_elements(o.quotation_snapshot->'selected_activities')
      WITH ORDINALITY item(value,ordinality);
  ELSE
    SELECT nullif(btrim(name),'') INTO activity_name FROM public.activities WHERE id=o.activity_id;
    IF o.price_per_person IS NULL OR o.num_participants IS NULL OR
      o.num_participants<=0 OR o.price_per_person*o.num_participants IS DISTINCT FROM o.total_price
    THEN RETURN NULL; END IF;
  END IF;
  description:=activity_name||' — '||o.order_number;
  IF description IS NULL OR length(description)>200 OR description=o.order_number OR
    description ~ '[[:cntrl:]]'
  THEN RETURN NULL; END IF;
  RETURN description;
END $$;
REVOKE ALL ON FUNCTION public.digital_order_service_description(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.digital_order_service_description(uuid) TO service_role;

CREATE FUNCTION public.digital_order_payment_issues(
  p_order_id uuid,p_actor_id uuid,p_billing jsonb
) RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c public.customer_snapshots%ROWTYPE;
  issues text[]:=ARRAY[]::text[]; kind text; identity text;
  paid numeric:=0; legacy_paid numeric:=0;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
    (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text IN ('admin','cashier'))
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
END $$;
REVOKE ALL ON FUNCTION public.digital_order_payment_issues(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.digital_order_payment_issues(uuid,uuid,jsonb) TO service_role;


-- Preserve existing reservation controls while supplying a real service line.
CREATE OR REPLACE FUNCTION public.reserve_pelecard_order_payment(
  p_payment_id UUID, p_order_id UUID, p_created_by UUID,
  p_idempotency_key TEXT, p_amount NUMERIC, p_currency TEXT,
  p_checkout_snapshot JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  order_row public.orders%ROWTYPE;
  existing public.payment_transactions%ROWTYPE;
  snapshot JSONB; activity_name text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_created_by
    AND role::text IN ('admin', 'cashier')) THEN
    RAISE EXCEPTION 'order_payment_forbidden' USING ERRCODE = '42501';
  END IF;
  -- One short reservation per order, including different idempotency keys.
  SELECT * INTO order_row FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_payable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO existing FROM public.payment_transactions
    WHERE provider = 'pelecard' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF existing.order_id IS DISTINCT FROM p_order_id
      OR existing.created_by IS DISTINCT FROM p_created_by
      OR existing.amount IS DISTINCT FROM p_amount
      OR existing.currency IS DISTINCT FROM p_currency THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23514';
    END IF;
    RETURN to_jsonb(existing) || jsonb_build_object('created', false);
  END IF;
  IF order_row.payment_status IS DISTINCT FROM 'לא שולם'
    OR order_row.status IN ('שולם', 'בוטל')
    OR order_row.total_price IS NULL OR order_row.total_price <= 0
    OR EXISTS (SELECT 1 FROM public.sales WHERE order_id = p_order_id)
    OR EXISTS (SELECT 1 FROM public.payment_transactions WHERE order_id = p_order_id
      AND operation = 'payment' AND status IN ('succeeded', 'refund_pending', 'refunded', 'void_pending', 'voided')) THEN
    RAISE EXCEPTION 'order_not_payable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_transactions WHERE order_id = p_order_id
    AND operation = 'payment' AND status IN ('initiated', 'pending_provider', 'timed_out')) THEN
    RAISE EXCEPTION 'order_payment_in_progress' USING ERRCODE = '23514';
  END IF;
  -- The browser amount is only an expectation. It never becomes the payable amount.
  IF p_amount IS DISTINCT FROM order_row.total_price OR p_currency IS DISTINCT FROM 'ILS' THEN
    RAISE EXCEPTION 'order_amount_mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT public.digital_order_service_description(order_row.id) INTO activity_name;
  IF activity_name IS NULL THEN RAISE EXCEPTION 'invoice_lines_required' USING ERRCODE='23514'; END IF;
  snapshot := jsonb_build_object(
    'schema_version', 1,
    'items', jsonb_build_array(jsonb_build_object(
      'id', order_row.id::text, 'name', activity_name,
      'qty', 1, 'customPrice', order_row.total_price)),
    'discount', NULL,
    'linked_order_info', jsonb_build_object(
      'order_number', order_row.order_number, 'client_name', order_row.client_name,
      'client_phone', order_row.client_phone, 'organization', COALESCE(order_row.organization, '')),
    'sale_date', CURRENT_DATE::text);
  RETURN public.reserve_pelecard_payment(p_payment_id, p_order_id, p_created_by,
    p_idempotency_key, order_row.total_price, 'ILS', snapshot);
END;
$$;

-- Repeat the same eligibility check under the order lock, before reservation.
CREATE OR REPLACE FUNCTION public.reserve_pelecard_live_order(
 p_order_id uuid,p_actor_id uuid,p_expected_amount_minor integer,
 p_previous_payment_id uuid,p_billing jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; o public.orders%ROWTYPE; c public.customer_snapshots%ROWTYPE;
 input jsonb; kind text; name text; identity text; email text; vat boolean; issues text[];
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text IN ('admin','cashier'))
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 input:=CASE WHEN jsonb_typeof(p_billing)='object' THEN p_billing ELSE '{}'::jsonb END;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 issues:=public.digital_order_payment_issues(p_order_id,p_actor_id,input);
 IF array_length(issues,1) IS NOT NULL THEN RAISE EXCEPTION 'digital_order_not_eligible' USING ERRCODE='23514'; END IF;
 IF o.total_price*100 IS DISTINCT FROM p_expected_amount_minor::numeric THEN
  RAISE EXCEPTION 'order_amount_mismatch' USING ERRCODE='23514'; END IF;
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
REVOKE ALL ON FUNCTION public.reserve_pelecard_order_payment(uuid,uuid,uuid,text,numeric,text,jsonb),
 public.reserve_pelecard_live_order(uuid,uuid,integer,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_pelecard_order_payment(uuid,uuid,uuid,text,numeric,text,jsonb),
 public.reserve_pelecard_live_order(uuid,uuid,integer,uuid,jsonb) TO service_role;
COMMIT;
