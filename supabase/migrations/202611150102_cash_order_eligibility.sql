-- An order cash receipt must be invoice-ready before money is recorded.
-- The existing 202611150001 function is retained privately for idempotent writes.
BEGIN;

ALTER FUNCTION public.record_payper_order_collection(
  uuid,uuid,uuid,text,integer,jsonb,jsonb,text,text)
  RENAME TO record_payper_order_collection_unguarded;
REVOKE ALL ON FUNCTION public.record_payper_order_collection_unguarded(
  uuid,uuid,uuid,text,integer,jsonb,jsonb,text,text)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_payper_order_collection(
  p_actor_id uuid,p_request_key uuid,p_order_id uuid,p_method text,p_amount_minor integer,
  p_check jsonb,p_billing jsonb,p_document_type text,p_reference_document_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c public.customer_snapshots%ROWTYPE;
  defaults jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  -- The original function validates all fields of an idempotent repeat and
  -- returns its existing payment. Never reject a legitimate status recovery.
  IF EXISTS(SELECT 1 FROM public.payper_noncard_payments WHERE request_key=p_request_key) THEN
    RETURN public.record_payper_order_collection_unguarded(p_actor_id,p_request_key,
      p_order_id,p_method,p_amount_minor,p_check,p_billing,p_document_type,p_reference_document_id);
  END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  SELECT * INTO c FROM public.customer_snapshots WHERE id=o.customer_snapshot_id
    AND order_id=o.id AND customer_id=o.customer_id AND revision=o.customer_record_version;
  IF o.id IS NULL OR c.id IS NULL OR o.vat_applicable IS DISTINCT FROM true OR
    jsonb_typeof(c.data->'vat_applicable') IS DISTINCT FROM 'boolean' OR
    c.data->>'vat_applicable' IS DISTINCT FROM 'true' OR
    public.digital_order_service_description(o.id) IS NULL THEN
    RAISE EXCEPTION 'order_billing_or_vat_review_required' USING ERRCODE='23514'; END IF;
  defaults:=public.get_payper_billing_defaults(p_order_id,p_actor_id);
  IF p_billing IS DISTINCT FROM defaults OR
    nullif(btrim(defaults->>'name'),'') IS NULL OR
    coalesce(defaults->>'identity','') !~ '^[0-9]{9}$' OR
    defaults->>'identity'='000000000' OR
    (defaults->>'kind'='person' AND
      NOT public.payper_valid_person_identity(defaults->>'identity')) OR
    coalesce(defaults->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'order_billing_review_required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.accounting_documents d WHERE d.status<>'permanent_error' AND
      ((d.source_type='order' AND d.source_id=o.id::text) OR
       (d.source_type='sale' AND EXISTS(SELECT 1 FROM public.sales s
         WHERE s.order_id=o.id AND s.id::text=d.source_id)) OR
       (d.source_type='payment_transaction' AND EXISTS
         (SELECT 1 FROM public.payment_transactions p
           WHERE p.order_id=o.id AND p.id::text=d.source_id)))) OR
     EXISTS(SELECT 1 FROM public.payper_document_ledger l WHERE l.order_id=o.id
       AND l.state IN ('dispatch_reserved','reconciliation_required','succeeded')) THEN
    RAISE EXCEPTION 'order_accounting_review_required' USING ERRCODE='23514'; END IF;
  RETURN public.record_payper_order_collection_unguarded(p_actor_id,p_request_key,
    p_order_id,p_method,p_amount_minor,p_check,p_billing,p_document_type,p_reference_document_id);
END $$;
REVOKE ALL ON FUNCTION public.record_payper_order_collection(
  uuid,uuid,uuid,text,integer,jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_payper_order_collection(
  uuid,uuid,uuid,text,integer,jsonb,jsonb,text,text) TO service_role;

COMMIT;
