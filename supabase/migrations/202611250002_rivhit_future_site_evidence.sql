-- Backward-compatible site evidence for future payments. No data update and
-- no change to Rivhit capture/posting flags. Legacy checkout RPCs still work;
-- only site-bearing requests become eligible for future journal mapping.
BEGIN;

DO $$ BEGIN
  IF pg_catalog.to_regprocedure('public.reserve_pos_pelecard(uuid,uuid,jsonb,jsonb,jsonb)') IS NULL
    OR pg_catalog.to_regprocedure('public.record_payper_noncard_sale(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text,integer)') IS NULL
    OR pg_catalog.to_regclass('public.rivhit_journal_sources') IS NULL
    OR pg_catalog.to_regclass('public.payment_transactions') IS NULL
  THEN RAISE EXCEPTION 'unexpected_site_evidence_baseline' USING ERRCODE='23514'; END IF;
END $$;

-- Keep every existing snapshot validation, including the physical order
-- compatibility shape. Only a known site may be added as one new top-level
-- field; all other fields are validated by the original safe predicates.
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT payment_transactions_checkout_snapshot_check;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_checkout_snapshot_check CHECK (
    pg_catalog.jsonb_typeof(checkout_snapshot)='object'
    AND (NOT checkout_snapshot ? 'site' OR
      (pg_catalog.jsonb_typeof(checkout_snapshot->'site')='string'
       AND checkout_snapshot->>'site' IN
         ('עכו','טבריה','נוף הגליל','שטח','פודטראק','קפה אקסטרים')))
    AND (public.payment_checkout_snapshot_is_safe(checkout_snapshot-'site') OR
      (provider='pelecard' AND operation='payment' AND order_id IS NOT NULL
       AND idempotency_key LIKE 'physical-%' AND checkout_snapshot ? 'source_order'
       AND public.payment_checkout_snapshot_is_safe(checkout_snapshot-'site'-'source_order')
       AND public.physical_order_source_is_safe(checkout_snapshot->'source_order')
       AND checkout_snapshot #>> '{source_order,orderId}'=order_id::text
       AND (checkout_snapshot #>> '{source_order,collected}')::numeric=amount)));

-- Quotations can be converted directly by RPC, outside the order form. A
-- quotation with no site needs an explicit correction before conversion.
CREATE FUNCTION public.require_site_for_quoted_order() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.quote_id IS NOT NULL AND NEW.site IS NULL THEN
    RAISE EXCEPTION 'order_site_required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_require_site_for_quoted_order BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.require_site_for_quoted_order();
REVOKE ALL ON FUNCTION public.require_site_for_quoted_order() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.freeze_payment_accounting_site() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE site_value text;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' OR NEW.operation <> 'payment'
    OR NEW.checkout_snapshot IS NULL OR pg_catalog.jsonb_typeof(NEW.checkout_snapshot) <> 'object'
  THEN RETURN NEW; END IF;

  IF NEW.order_id IS NOT NULL THEN
    SELECT o.site INTO site_value FROM public.orders o WHERE o.id=NEW.order_id;
  ELSE
    site_value := nullif(pg_catalog.current_setting('shafan.accounting_site',true),'');
    IF site_value IS NULL THEN site_value := NEW.checkout_snapshot->>'site'; END IF;
  END IF;
  IF site_value IS NULL THEN RETURN NEW; END IF;
  IF site_value NOT IN ('עכו','טבריה','נוף הגליל','שטח','פודטראק','קפה אקסטרים')
    OR (NEW.checkout_snapshot ? 'site' AND NEW.checkout_snapshot->>'site' IS DISTINCT FROM site_value)
  THEN RAISE EXCEPTION 'accounting_site_invalid' USING ERRCODE='23514'; END IF;
  NEW.checkout_snapshot := pg_catalog.jsonb_set(NEW.checkout_snapshot,'{site}',pg_catalog.to_jsonb(site_value),true);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_freeze_payment_accounting_site BEFORE INSERT ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.freeze_payment_accounting_site();
REVOKE ALL ON FUNCTION public.freeze_payment_accounting_site() FROM PUBLIC,anon,authenticated,service_role;

-- The original reservation remains atomic and keeps all existing financial
-- guards. SET LOCAL is scoped to this RPC transaction and reset on return.
CREATE FUNCTION public.reserve_pos_pelecard_with_site(
  p_actor_id uuid,p_request_key uuid,p_lines jsonb,p_discount jsonb,p_billing jsonb,p_site text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; stored_site text;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_site IS NULL OR p_site NOT IN ('עכו','טבריה','נוף הגליל','שטח','פודטראק','קפה אקסטרים') THEN
    RAISE EXCEPTION 'accounting_site_invalid' USING ERRCODE='23514'; END IF;
  PERFORM pg_catalog.set_config('shafan.accounting_site',p_site,true);
  result := public.reserve_pos_pelecard(p_actor_id,p_request_key,p_lines,p_discount,p_billing - 'site');
  PERFORM pg_catalog.set_config('shafan.accounting_site','',true);
  SELECT p.checkout_snapshot->>'site' INTO stored_site FROM public.payment_transactions p
    WHERE p.id=(result->>'paymentId')::uuid;
  IF stored_site IS DISTINCT FROM p_site THEN
    RAISE EXCEPTION 'request_key_conflict' USING ERRCODE='23514'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reserve_pos_pelecard_with_site(uuid,uuid,jsonb,jsonb,jsonb,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_pos_pelecard_with_site(uuid,uuid,jsonb,jsonb,jsonb,text)
  TO service_role;

CREATE FUNCTION public.record_payper_noncard_sale_with_site(
  p_actor_id uuid,p_request_key uuid,p_method text,p_lines jsonb,p_discount jsonb,
  p_check jsonb,p_billing jsonb,p_document_type text,p_reference_document_id text,
  p_expected_minor integer,p_site text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; stored_site text;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_site IS NULL OR p_site NOT IN ('עכו','טבריה','נוף הגליל','שטח','פודטראק','קפה אקסטרים') THEN
    RAISE EXCEPTION 'accounting_site_invalid' USING ERRCODE='23514'; END IF;
  PERFORM pg_catalog.set_config('shafan.accounting_site',p_site,true);
  result := public.record_payper_noncard_sale(p_actor_id,p_request_key,p_method,p_lines,
    p_discount,p_check,p_billing - 'site',p_document_type,p_reference_document_id,p_expected_minor);
  PERFORM pg_catalog.set_config('shafan.accounting_site','',true);
  SELECT p.checkout_snapshot->>'site' INTO stored_site FROM public.payment_transactions p
    WHERE p.id=(result->>'paymentId')::uuid;
  IF stored_site IS DISTINCT FROM p_site THEN
    RAISE EXCEPTION 'request_key_conflict' USING ERRCODE='23514'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_payper_noncard_sale_with_site(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text,integer,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_payper_noncard_sale_with_site(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text,integer,text)
  TO service_role;

-- Derive the journal source only from the immutable payment snapshot. An
-- order edited after payment cannot silently reclassify its earlier sale.
CREATE FUNCTION public.freeze_rivhit_source_site() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE site_value text;
BEGIN
  SELECT p.checkout_snapshot->>'site' INTO site_value
    FROM public.payment_transactions p WHERE p.id=NEW.payment_id;
  IF site_value NOT IN ('עכו','טבריה','נוף הגליל','שטח','פודטראק','קפה אקסטרים')
    THEN site_value := NULL; END IF;
  NEW.source_facts := NEW.source_facts || pg_catalog.jsonb_build_object('site',site_value);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_freeze_rivhit_source_site BEFORE INSERT ON public.rivhit_journal_sources
  FOR EACH ROW EXECUTE FUNCTION public.freeze_rivhit_source_site();
REVOKE ALL ON FUNCTION public.freeze_rivhit_source_site() FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
