-- Additive preparation only. This migration cannot activate journal posting.
-- A separately approved migration must remove the disabled checks and set a
-- future cutover after manual Rivhit journals have been reconciled.
BEGIN;

CREATE TABLE public.rivhit_journal_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  capture_enabled boolean NOT NULL DEFAULT false CHECK (capture_enabled = false),
  posting_enabled boolean NOT NULL DEFAULT false CHECK (posting_enabled = false),
  cutover_at timestamptz,
  CHECK (NOT posting_enabled OR (capture_enabled AND cutover_at IS NOT NULL))
);
INSERT INTO public.rivhit_journal_control(singleton) VALUES (true);
ALTER TABLE public.rivhit_journal_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rivhit_journal_control FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.rivhit_journal_control TO service_role;
CREATE POLICY rivhit_journal_control_admin_read ON public.rivhit_journal_control
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role::text='admin'));
GRANT SELECT ON public.rivhit_journal_control TO authenticated;

-- Empty until Anat approves each provider/site mapping in a separate activation release.
CREATE TABLE public.rivhit_journal_approved_mappings (
  provider text NOT NULL CHECK (provider IN ('pelecard','manual_cash','manual_check')),
  site text NOT NULL DEFAULT '' CHECK (site IN ('','עכו','טבריה','נוף הגליל','שטח')),
  mapping_version text NOT NULL CHECK (mapping_version ~ '^v1-[0-9a-f]{64}$'),
  approved_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (provider,site)
);
ALTER TABLE public.rivhit_journal_approved_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rivhit_journal_approved_mappings FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY rivhit_journal_approved_mappings_admin_read
  ON public.rivhit_journal_approved_mappings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.role::text='admin'));
GRANT SELECT ON public.rivhit_journal_approved_mappings TO authenticated, service_role;

CREATE TABLE public.rivhit_journal_sources (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  payper_ledger_id uuid NOT NULL UNIQUE REFERENCES public.payper_document_ledger(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  payper_document_number text NOT NULL UNIQUE CHECK (pg_catalog.length(pg_catalog.btrim(payper_document_number)) > 0),
  payper_document_url text NOT NULL CHECK (payper_document_url ~
    '^https://(app\.)?payper\.co\.il/(app/)?public/invoice_show/[1-9][0-9]*(\?[^#]*)?$'),
  source_facts jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(source_facts) = 'object'),
  state text NOT NULL DEFAULT 'mapping_required' CHECK (state IN
    ('mapping_required','mapped','manual_existing','reconciliation_required')),
  captured_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  next_mapping_check_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE INDEX rivhit_journal_sources_payment_idx ON public.rivhit_journal_sources(payment_id);
CREATE INDEX rivhit_journal_sources_queue_idx ON public.rivhit_journal_sources
  (next_mapping_check_at,id) WHERE state='mapping_required';
ALTER TABLE public.rivhit_journal_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rivhit_journal_sources FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY rivhit_journal_sources_admin_read ON public.rivhit_journal_sources
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::text = 'admin'));
GRANT SELECT ON public.rivhit_journal_sources TO authenticated, service_role;

CREATE TABLE public.rivhit_journal_entries (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.rivhit_journal_sources(id) ON DELETE RESTRICT,
  entry_key text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(entry_key)) > 0),
  mapping_version text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(mapping_version)) > 0),
  request_reference text NOT NULL UNIQUE CHECK (pg_catalog.length(pg_catalog.btrim(request_reference)) > 0),
  request_payload jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(request_payload) = 'object'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  expected_vat numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN
    ('ready','reserved','response_saved','verified','manual_existing',
     'reconciliation_required','definitive_rejection')),
  dispatch_reserved_at timestamptz,
  provider_year integer,
  provider_month integer,
  provider_line integer,
  report_journal_id integer,
  response_saved_at timestamptz,
  verified_at timestamptz,
  next_reconciliation_check_at timestamptz,
  hold_reason text,
  reconciliation_evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (source_id, entry_key),
  CHECK (status = 'ready' OR dispatch_reserved_at IS NOT NULL
    OR status IN ('manual_existing','reconciliation_required')),
  CHECK (status <> 'verified' OR (provider_year IS NOT NULL AND provider_month IS NOT NULL
    AND provider_line IS NOT NULL AND report_journal_id IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX rivhit_journal_entries_review_idx ON public.rivhit_journal_entries(status,created_at);
CREATE INDEX rivhit_journal_entries_reconcile_idx ON public.rivhit_journal_entries
  (next_reconciliation_check_at,id)
  WHERE status IN ('reserved','response_saved','reconciliation_required');
ALTER TABLE public.rivhit_journal_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rivhit_journal_entries FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY rivhit_journal_entries_admin_read ON public.rivhit_journal_entries
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::text = 'admin'));
GRANT SELECT ON public.rivhit_journal_entries TO authenticated, service_role;

CREATE FUNCTION public.protect_rivhit_journal_entry_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.entry_key IS DISTINCT FROM OLD.entry_key
    OR NEW.mapping_version IS DISTINCT FROM OLD.mapping_version
    OR NEW.request_reference IS DISTINCT FROM OLD.request_reference
    OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
    OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
    OR NEW.expected_vat IS DISTINCT FROM OLD.expected_vat THEN
    RAISE EXCEPTION 'rivhit_journal_entry_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_protect_rivhit_journal_entry_identity BEFORE UPDATE
  ON public.rivhit_journal_entries FOR EACH ROW
  EXECUTE FUNCTION public.protect_rivhit_journal_entry_identity();
REVOKE ALL ON FUNCTION public.protect_rivhit_journal_entry_identity()
  FROM PUBLIC, anon, authenticated, service_role;

-- This trigger has zero effect while capture_enabled is constrained to false.
CREATE FUNCTION public.capture_rivhit_journal_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.payment_transactions%ROWTYPE; s public.sales%ROWTYPE;
  o public.orders%ROWTYPE; b public.payper_payment_billing_snapshots%ROWTYPE;
  cutoff timestamptz;
BEGIN
  IF NEW.state <> 'succeeded' OR NEW.document_origin <> 'automatic'
    OR NEW.document_number IS NULL OR NEW.document_url IS NULL
    OR NEW.document_url !~ '^https://(app\.)?payper\.co\.il/(app/)?public/invoice_show/[1-9][0-9]*(\?[^#]*)?$'
    OR (TG_OP = 'UPDATE' AND OLD.state = 'succeeded') THEN RETURN NEW; END IF;
  SELECT c.cutover_at INTO cutoff FROM public.rivhit_journal_control c
    WHERE c.singleton AND c.capture_enabled;
  IF cutoff IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p FROM public.payment_transactions WHERE id = NEW.payment_id;
  SELECT * INTO s FROM public.sales WHERE id = NEW.sale_id;
  SELECT * INTO o FROM public.orders WHERE id = NEW.order_id;
  SELECT * INTO b FROM public.payper_payment_billing_snapshots WHERE payment_id=NEW.payment_id;
  IF p.id IS NULL OR s.id IS NULL OR (NEW.order_id IS NOT NULL AND o.id IS NULL)
    OR p.status <> 'succeeded'
    OR p.operation <> 'payment' OR p.sale_id IS DISTINCT FROM s.id
    OR NEW.order_id IS DISTINCT FROM p.order_id
    OR p.currency <> 'ILS' OR p.amount IS DISTINCT FROM s.total OR p.created_at < cutoff
    OR (p.provider = 'pelecard' AND (p.verified_at IS NULL OR p.verified_at < cutoff
      OR p.provider_transaction_id IS NULL))
    OR (p.provider IN ('manual_cash','manual_check') AND NOT EXISTS (
      SELECT 1 FROM public.payper_noncard_payments n
      WHERE n.payment_id=p.id AND n.sale_id=s.id
        AND n.method=CASE WHEN p.provider='manual_cash' THEN 'cash' ELSE 'check' END
        AND n.amount_minor=pg_catalog.round(p.amount*100)::integer
        AND NEW.source_facts->>'sourceType'=p.provider))
    OR p.provider NOT IN ('pelecard','manual_cash','manual_check')
    OR NEW.updated_at < cutoff OR NEW.payment_id IS DISTINCT FROM p.id THEN RETURN NEW; END IF;
  INSERT INTO public.rivhit_journal_sources
    (payper_ledger_id,payment_id,sale_id,payper_document_number,payper_document_url,source_facts)
  VALUES (NEW.id,p.id,s.id,NEW.document_number,NEW.document_url,
    pg_catalog.jsonb_build_object('paymentId',p.id,'saleId',s.id,'orderId',p.order_id,
      'provider',p.provider,'amount',p.amount,'currency',p.currency,
      'vatApplicable',coalesce(b.vat_applicable,o.vat_applicable,
        CASE WHEN pg_catalog.jsonb_typeof(NEW.source_facts->'vatApplicable')='boolean'
          THEN (NEW.source_facts->>'vatApplicable')::boolean ELSE NULL END,
        CASE WHEN pg_catalog.jsonb_typeof(NEW.source_facts->'billing'->'vat_applicable')='boolean'
          THEN (NEW.source_facts->'billing'->>'vat_applicable')::boolean ELSE NULL END),
      'saleMethod',s.method,'site',o.site,'receiptNumber',s.receipt_number,
      'documentNumber',NEW.document_number,'documentOrigin',NEW.document_origin,
      'paymentCreatedAt',p.created_at,'paymentVerifiedAt',p.verified_at,
      'sourceFacts',NEW.source_facts))
  ON CONFLICT (payper_ledger_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_capture_rivhit_journal_source AFTER INSERT OR UPDATE OF state
  ON public.payper_document_ledger FOR EACH ROW
  EXECUTE FUNCTION public.capture_rivhit_journal_source();
REVOKE ALL ON FUNCTION public.capture_rivhit_journal_source()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.stage_rivhit_journal_entry(
  p_source_id uuid, p_entry_key text, p_mapping_version text,
  p_request_reference text, p_request_payload jsonb,
  p_payload_hash text, p_expected_vat numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rivhit_journal_control c
    JOIN public.rivhit_journal_sources s ON s.id=p_source_id
    JOIN public.rivhit_journal_approved_mappings m
      ON m.provider=s.source_facts->>'provider'
      AND m.site=coalesce(s.source_facts->>'site','')
      AND m.mapping_version=p_mapping_version
    WHERE c.singleton AND c.capture_enabled) THEN
    RAISE EXCEPTION 'rivhit_journal_mapping_disabled' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rivhit_journal_sources s
    JOIN public.payper_document_ledger l ON l.id=s.payper_ledger_id
    JOIN public.payment_transactions p ON p.id=s.payment_id
    WHERE s.id = p_source_id AND s.state = 'mapping_required'
      AND l.state='succeeded' AND l.document_origin='automatic'
      AND l.document_number=s.payper_document_number
      AND l.order_id IS NOT DISTINCT FROM p.order_id
      AND l.sale_id=s.sale_id AND p.sale_id=s.sale_id
      AND p.status='succeeded' AND p.operation='payment'
      AND p.created_at >= (SELECT cutover_at FROM public.rivhit_journal_control WHERE singleton)) THEN
    RAISE EXCEPTION 'rivhit_journal_source_not_ready' USING ERRCODE = '42501'; END IF;
  IF p_request_payload IS NULL OR p_request_payload ? 'api_token'
    OR p_request_payload->>'request_reference' IS DISTINCT FROM p_request_reference
    OR p_request_payload->>'sort_code' IS NULL
    OR p_request_payload->>'customer_id_debit' IS NULL
    OR pg_catalog.jsonb_typeof(p_request_payload->'amount') <> 'number'
    OR p_request_payload->>'reference1' IS NULL
    OR p_request_payload->>'reference2' IS NULL
    OR p_expected_vat IS NULL OR p_expected_vat < 0
    OR NOT EXISTS (SELECT 1 FROM public.rivhit_journal_sources s
      WHERE s.id=p_source_id
        AND p_request_payload->>'reference1'=s.payper_document_number
        AND p_request_payload->>'reference2'=s.source_facts->>'receiptNumber'
        AND (p_request_payload->>'amount')::numeric=(s.source_facts->>'amount')::numeric
        AND p_expected_vat <= (s.source_facts->>'amount')::numeric) THEN
    RAISE EXCEPTION 'rivhit_journal_payload_invalid' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.rivhit_journal_entries(source_id,entry_key,mapping_version,
    request_reference,request_payload,payload_hash,expected_vat)
  VALUES(p_source_id,p_entry_key,p_mapping_version,p_request_reference,
    p_request_payload,p_payload_hash,p_expected_vat)
  ON CONFLICT (source_id,entry_key) DO NOTHING RETURNING id INTO result;
  IF result IS NULL THEN
    SELECT e.id INTO result FROM public.rivhit_journal_entries e
      WHERE e.source_id = p_source_id AND e.entry_key = p_entry_key
        AND e.mapping_version = p_mapping_version
        AND e.request_reference = p_request_reference
        AND e.request_payload = p_request_payload
        AND e.payload_hash = p_payload_hash AND e.expected_vat = p_expected_vat;
    IF result IS NULL THEN RAISE EXCEPTION 'rivhit_journal_idempotency_mismatch' USING ERRCODE='23505'; END IF;
  END IF;
  UPDATE public.rivhit_journal_sources SET state='mapped'
    WHERE id=p_source_id AND state='mapping_required';
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.stage_rivhit_journal_entry(uuid,text,text,text,jsonb,text,numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_rivhit_journal_entry(uuid,text,text,text,jsonb,text,numeric)
  TO service_role;

CREATE FUNCTION public.defer_rivhit_journal_source(p_source_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  UPDATE public.rivhit_journal_sources
    SET next_mapping_check_at=pg_catalog.clock_timestamp()+INTERVAL '15 minutes'
  WHERE id=p_source_id AND state='mapping_required';
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION public.defer_rivhit_journal_source(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_rivhit_journal_source(uuid) TO service_role;

CREATE FUNCTION public.reserve_rivhit_journal_entry(p_entry_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rivhit_journal_control c
    WHERE c.singleton AND c.posting_enabled AND c.capture_enabled
      AND c.cutover_at IS NOT NULL) THEN
    RAISE EXCEPTION 'rivhit_journal_posting_disabled' USING ERRCODE='42501'; END IF;
  UPDATE public.rivhit_journal_entries e SET status = 'reserved',
    dispatch_reserved_at = pg_catalog.clock_timestamp(),
    next_reconciliation_check_at = pg_catalog.clock_timestamp()+INTERVAL '2 minutes'
  WHERE e.id = p_entry_id AND e.status = 'ready'
    AND EXISTS (SELECT 1 FROM public.rivhit_journal_sources s
      JOIN public.rivhit_journal_approved_mappings m
        ON m.provider=s.source_facts->>'provider'
        AND m.site=coalesce(s.source_facts->>'site','')
        AND m.mapping_version=e.mapping_version
      WHERE s.id=e.source_id)
    AND EXISTS (SELECT 1 FROM public.rivhit_journal_sources s
      JOIN public.payper_document_ledger l ON l.id=s.payper_ledger_id
      JOIN public.payment_transactions p ON p.id=s.payment_id
      WHERE s.id=e.source_id AND l.state='succeeded'
        AND l.document_origin='automatic' AND p.status='succeeded'
        AND p.operation='payment')
  RETURNING pg_catalog.jsonb_build_object('id',e.id,'payload',e.request_payload,
    'hash',e.payload_hash,'expectedVat',e.expected_vat) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reserve_rivhit_journal_entry(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_rivhit_journal_entry(uuid) TO service_role;

CREATE FUNCTION public.record_rivhit_journal_response(
  p_entry_id uuid, p_year integer, p_month integer, p_line integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_year IS NULL OR p_year < 1 OR p_month NOT BETWEEN 1 AND 12
    OR p_line IS NULL OR p_line < 1 THEN
    RAISE EXCEPTION 'rivhit_journal_reference_invalid' USING ERRCODE='22023'; END IF;
  UPDATE public.rivhit_journal_entries SET status='response_saved',
    provider_year=p_year,provider_month=p_month,provider_line=p_line,
    response_saved_at=pg_catalog.clock_timestamp()
  WHERE id=p_entry_id AND status='reserved';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION public.record_rivhit_journal_response(uuid,integer,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_rivhit_journal_response(uuid,integer,integer,integer)
  TO service_role;

CREATE FUNCTION public.hold_rivhit_journal_entry(p_entry_id uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR p_reason !~ '^[a-z0-9_]{1,80}$' THEN
    RAISE EXCEPTION 'rivhit_journal_hold_reason_invalid' USING ERRCODE='22023'; END IF;
  UPDATE public.rivhit_journal_entries SET status='reconciliation_required',
    hold_reason=p_reason,
    next_reconciliation_check_at=pg_catalog.clock_timestamp()+INTERVAL '15 minutes'
  WHERE id=p_entry_id AND status IN ('ready','reserved','response_saved');
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION public.hold_rivhit_journal_entry(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_rivhit_journal_entry(uuid,text) TO service_role;

CREATE FUNCTION public.verify_rivhit_journal_entry(p_entry_id uuid,p_journal_id integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_journal_id IS NULL OR p_journal_id < 1 THEN
    RAISE EXCEPTION 'rivhit_journal_id_invalid' USING ERRCODE='22023'; END IF;
  UPDATE public.rivhit_journal_entries SET status='verified',hold_reason=NULL,
    report_journal_id=p_journal_id,verified_at=pg_catalog.clock_timestamp()
  WHERE id=p_entry_id AND status IN ('response_saved','reconciliation_required')
    AND provider_year IS NOT NULL AND provider_month IS NOT NULL AND provider_line IS NOT NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION public.verify_rivhit_journal_entry(uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_rivhit_journal_entry(uuid,integer) TO service_role;

CREATE FUNCTION public.record_rivhit_journal_reconciliation(
  p_entry_id uuid,p_report_journal_id integer,p_reason text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_report_journal_id IS NULL OR p_report_journal_id < 1
    OR p_reason IS NULL
    OR p_reason NOT IN ('candidate_without_response','readback_conflict') THEN
    RAISE EXCEPTION 'rivhit_journal_reconciliation_invalid' USING ERRCODE='22023'; END IF;
  UPDATE public.rivhit_journal_entries SET status='reconciliation_required',
    hold_reason=p_reason,
    next_reconciliation_check_at=pg_catalog.clock_timestamp()+INTERVAL '15 minutes',
    reconciliation_evidence=pg_catalog.jsonb_build_object(
      'reportJournalId',p_report_journal_id,'observedAt',pg_catalog.clock_timestamp())
  WHERE id=p_entry_id AND status IN ('reserved','response_saved','reconciliation_required');
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION public.record_rivhit_journal_reconciliation(uuid,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_rivhit_journal_reconciliation(uuid,integer,text)
  TO service_role;

COMMENT ON TABLE public.rivhit_journal_entries IS
  'Prepared Rivhit journal lines only. Posting remains disabled pending accountant mappings and manual-entry reconciliation.';
COMMIT;
