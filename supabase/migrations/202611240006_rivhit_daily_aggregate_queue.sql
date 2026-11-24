-- Future-only daily aggregate preparation. Capture and posting stay disabled.
-- A batch may contain several finalized Payper documents, but each source may
-- belong to exactly one batch. Late documents enter a later posting window.
BEGIN;

ALTER TABLE public.rivhit_journal_control
  ADD CONSTRAINT rivhit_daily_close_time CHECK (posting_cadence<>'daily'
    OR posting_time_israel BETWEEN TIME '23:00' AND TIME '23:30:00');

CREATE TABLE public.rivhit_daily_journal_batches (
  id uuid PRIMARY KEY,
  posting_day date NOT NULL,
  provider text NOT NULL CHECK (provider IN ('pelecard','manual_cash','manual_check')),
  site text NOT NULL,
  mapping_version text NOT NULL,
  CONSTRAINT rivhit_one_daily_group UNIQUE (posting_day,provider,site,mapping_version),
  source_count integer NOT NULL CHECK (source_count BETWEEN 1 AND 500),
  gross_amount numeric(12,2) NOT NULL CHECK (gross_amount > 0),
  vat_amount numeric(12,2) NOT NULL CHECK (vat_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE INDEX rivhit_daily_batches_day_idx ON public.rivhit_daily_journal_batches
  (posting_day,site,provider);
ALTER TABLE public.rivhit_daily_journal_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rivhit_daily_journal_batches FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.rivhit_daily_journal_batches TO authenticated,service_role;
CREATE POLICY rivhit_daily_batches_admin_read ON public.rivhit_daily_journal_batches
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.role::text='admin'));

CREATE TABLE public.rivhit_daily_journal_members (
  batch_id uuid NOT NULL REFERENCES public.rivhit_daily_journal_batches(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL UNIQUE REFERENCES public.rivhit_journal_sources(id) ON DELETE RESTRICT,
  PRIMARY KEY (batch_id,source_id)
);
ALTER TABLE public.rivhit_daily_journal_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rivhit_daily_journal_members FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.rivhit_daily_journal_members TO authenticated,service_role;
CREATE POLICY rivhit_daily_members_admin_read ON public.rivhit_daily_journal_members
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.role::text='admin'));

ALTER TABLE public.rivhit_journal_entries
  ADD COLUMN batch_id uuid UNIQUE REFERENCES public.rivhit_daily_journal_batches(id) ON DELETE RESTRICT;
CREATE FUNCTION public.protect_rivhit_daily_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'rivhit_daily_identity_immutable' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_protect_rivhit_daily_batches BEFORE UPDATE OR DELETE
  ON public.rivhit_daily_journal_batches FOR EACH ROW
  EXECUTE FUNCTION public.protect_rivhit_daily_identity();
CREATE TRIGGER trg_protect_rivhit_daily_members BEFORE UPDATE OR DELETE
  ON public.rivhit_daily_journal_members FOR EACH ROW
  EXECUTE FUNCTION public.protect_rivhit_daily_identity();
CREATE FUNCTION public.protect_rivhit_daily_entry_link() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
    RAISE EXCEPTION 'rivhit_daily_entry_immutable' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_protect_rivhit_daily_entry_link BEFORE UPDATE
  ON public.rivhit_journal_entries FOR EACH ROW
  EXECUTE FUNCTION public.protect_rivhit_daily_entry_link();
REVOKE ALL ON FUNCTION public.protect_rivhit_daily_identity(),
  public.protect_rivhit_daily_entry_link() FROM PUBLIC,anon,authenticated,service_role;

-- A cron wake-up may arrive at any minute. Staging and dispatch are allowed
-- only in the configured Israel-time closing window, and never in another mode.
CREATE OR REPLACE FUNCTION public.rivhit_journal_posting_window_open()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce((SELECT c.capture_enabled AND c.posting_enabled
    AND c.posting_cadence='daily' AND c.cutover_at IS NOT NULL
    AND (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::time
      >= c.posting_time_israel
    FROM public.rivhit_journal_control c WHERE c.singleton),false)
$$;

-- Old per-document staging cannot be invoked after activation, including by
-- a mistakenly deployed older worker. The queue is empty before cutover.
REVOKE EXECUTE ON FUNCTION public.stage_rivhit_journal_entry(
  uuid,text,text,text,jsonb,text,numeric) FROM service_role;

CREATE OR REPLACE FUNCTION public.enforce_rivhit_approved_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.rivhit_daily_journal_batches%ROWTYPE;
  m public.rivhit_journal_approved_mappings%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.status='reserved' AND OLD.status='ready'
      AND NOT public.rivhit_journal_posting_window_open() THEN
      RAISE EXCEPTION 'rivhit_journal_posting_schedule_closed' USING ERRCODE='42501'; END IF;
    IF NEW.status<>'reserved' OR OLD.status<>'ready' THEN RETURN NEW; END IF;
  END IF;
  IF NEW.batch_id IS NULL OR NEW.entry_key<>'daily' THEN
    RAISE EXCEPTION 'rivhit_daily_batch_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO b FROM public.rivhit_daily_journal_batches WHERE id=NEW.batch_id;
  SELECT * INTO m FROM public.rivhit_journal_approved_mappings a
    WHERE a.provider=b.provider AND a.site=b.site
      AND a.mapping_version=b.mapping_version AND a.enabled;
  IF NOT FOUND OR NEW.mapping_version IS DISTINCT FROM b.mapping_version
    OR NEW.request_payload->>'sort_code' IS DISTINCT FROM m.sort_code::text
    OR NEW.request_payload->>'customer_id_debit' IS DISTINCT FROM m.debit_account::text
    OR NEW.request_payload->>'customer_id_credit' IS DISTINCT FROM m.credit_account::text
    OR NEW.request_payload->>'project_id' IS DISTINCT FROM m.project_id::text
    OR (NEW.request_payload->>'amount')::numeric IS DISTINCT FROM b.gross_amount
    OR NEW.expected_vat IS DISTINCT FROM b.vat_amount
    OR b.source_count IS DISTINCT FROM (SELECT count(*)::integer
      FROM public.rivhit_daily_journal_members x WHERE x.batch_id=b.id)
  THEN RAISE EXCEPTION 'rivhit_daily_mapping_not_approved' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;

-- All validation and membership insertion occur in one transaction. A lost
-- HTTP response can be looked up by the caller's stable batch UUID. It must
-- never cause a second AddJournal dispatch.
CREATE FUNCTION public.stage_rivhit_daily_batch(
  p_batch_id uuid,p_posting_day date,p_source_ids uuid[],p_mapping_version text,
  p_request_payload jsonb,p_payload_hash text,p_expected_vat numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.rivhit_journal_approved_mappings%ROWTYPE;
  anchor uuid; source_count integer; total numeric; vat_total numeric;
  provider_value text; site_value text; result uuid;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rivhit_journal_control c
    WHERE c.singleton AND c.capture_enabled AND c.posting_cadence='daily'
      AND c.cutover_at IS NOT NULL
      AND (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::time >= c.posting_time_israel)
    OR p_posting_day IS DISTINCT FROM
      (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date
    OR p_batch_id IS NULL OR p_source_ids IS NULL
    OR pg_catalog.cardinality(p_source_ids) NOT BETWEEN 1 AND 500
    OR (SELECT count(DISTINCT id) FROM pg_catalog.unnest(p_source_ids) id)
      <> pg_catalog.cardinality(p_source_ids)
    OR p_request_payload IS NULL OR p_request_payload ? 'api_token'
    OR p_request_payload->>'request_reference' IS DISTINCT FROM 'shafan:daily:'||p_batch_id::text
    OR p_request_payload->>'reference1' IS DISTINCT FROM p_batch_id::text
    OR p_request_payload->>'reference2' IS DISTINCT FROM 'SF-'||p_batch_id::text
    OR p_request_payload->>'reference_date' IS DISTINCT FROM
      pg_catalog.to_char(p_posting_day,'DDMMYYYY')
    OR p_payload_hash !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'rivhit_daily_batch_invalid' USING ERRCODE='22023'; END IF;

  PERFORM 1 FROM public.rivhit_journal_sources s
    WHERE s.id=ANY(p_source_ids) ORDER BY s.id FOR UPDATE;
  SELECT count(*)::integer,min(s.id::text)::uuid,
    min(s.source_facts->>'provider'),min(s.source_facts->>'site'),
    sum((s.source_facts->>'amount')::numeric),
    sum(pg_catalog.round(pg_catalog.round((s.source_facts->>'amount')::numeric*100)
      * approved.vat_rate_basis_points/(10000+approved.vat_rate_basis_points))/100)
  INTO source_count,anchor,provider_value,site_value,total,vat_total
  FROM public.rivhit_journal_sources s
  JOIN public.rivhit_journal_approved_mappings approved
    ON approved.provider=s.source_facts->>'provider'
    AND approved.site=s.source_facts->>'site'
    AND approved.enabled AND approved.mapping_version=p_mapping_version
  JOIN public.payper_document_ledger l ON l.id=s.payper_ledger_id
  JOIN public.payment_transactions p ON p.id=s.payment_id
  JOIN public.sales sale ON sale.id=s.sale_id
  WHERE s.id=ANY(p_source_ids) AND s.state='mapping_required'
    AND NOT EXISTS (SELECT 1 FROM public.rivhit_daily_journal_members x
      WHERE x.source_id=s.id)
    AND s.captured_at AT TIME ZONE 'Asia/Jerusalem' < (p_posting_day+1)::timestamp
    AND l.state='succeeded' AND l.document_origin='automatic'
    AND l.document_number=s.payper_document_number
    AND l.payment_id=s.payment_id AND l.sale_id=s.sale_id
    AND l.document_url=s.payper_document_url
    AND p.status='succeeded' AND p.operation='payment' AND p.sale_id=s.sale_id
    AND p.currency='ILS' AND p.amount=(s.source_facts->>'amount')::numeric
    AND sale.total >= p.amount
    AND p.checkout_snapshot->>'site'=s.source_facts->>'site'
    AND sale.receipt_number=s.source_facts->>'receiptNumber'
    AND pg_catalog.jsonb_typeof(s.source_facts->'vatApplicable')='boolean'
    AND (s.source_facts->>'vatApplicable')::boolean=(approved.vat_rate_basis_points>0);
  IF source_count IS DISTINCT FROM pg_catalog.cardinality(p_source_ids)
    OR provider_value IS NULL OR site_value IS NULL
    OR EXISTS (SELECT 1 FROM public.rivhit_journal_sources s
      WHERE s.id=ANY(p_source_ids) AND (s.source_facts->>'provider' IS DISTINCT FROM provider_value
        OR s.source_facts->>'site' IS DISTINCT FROM site_value))
  THEN RAISE EXCEPTION 'rivhit_daily_source_not_ready' USING ERRCODE='42501'; END IF;
  SELECT * INTO m FROM public.rivhit_journal_approved_mappings a
    WHERE a.provider=provider_value AND a.site=site_value
      AND a.mapping_version=p_mapping_version AND a.enabled;
  IF NOT FOUND OR p_request_payload->>'sort_code' IS DISTINCT FROM m.sort_code::text
    OR p_request_payload->>'customer_id_debit' IS DISTINCT FROM m.debit_account::text
    OR p_request_payload->>'customer_id_credit' IS DISTINCT FROM m.credit_account::text
    OR p_request_payload->>'project_id' IS DISTINCT FROM m.project_id::text
    OR (p_request_payload->>'amount')::numeric IS DISTINCT FROM total
    OR p_expected_vat IS DISTINCT FROM vat_total
  THEN RAISE EXCEPTION 'rivhit_daily_mapping_not_approved' USING ERRCODE='42501'; END IF;

  INSERT INTO public.rivhit_daily_journal_batches
    (id,posting_day,provider,site,mapping_version,source_count,gross_amount,vat_amount)
  VALUES (p_batch_id,p_posting_day,provider_value,site_value,p_mapping_version,
    source_count,total,vat_total);
  INSERT INTO public.rivhit_daily_journal_members(batch_id,source_id)
    SELECT p_batch_id,id FROM pg_catalog.unnest(p_source_ids) id;
  INSERT INTO public.rivhit_journal_entries
    (source_id,batch_id,entry_key,mapping_version,request_reference,
      request_payload,payload_hash,expected_vat)
  VALUES (anchor,p_batch_id,'daily',p_mapping_version,
    p_request_payload->>'request_reference',p_request_payload,p_payload_hash,p_expected_vat)
  RETURNING id INTO result;
  UPDATE public.rivhit_journal_sources SET state='mapped'
    WHERE id=ANY(p_source_ids) AND state='mapping_required';
  IF NOT FOUND THEN RAISE EXCEPTION 'rivhit_daily_source_changed' USING ERRCODE='40001'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.stage_rivhit_daily_batch(
  uuid,date,uuid[],text,jsonb,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stage_rivhit_daily_batch(
  uuid,date,uuid[],text,jsonb,text,numeric) TO service_role;

-- Read-only reconciliation view uses the exact immutable source membership.
CREATE FUNCTION public.rivhit_daily_batch_status(p_day date DEFAULT NULL)
RETURNS TABLE (posting_day date,site text,payment_method text,source_count integer,
  gross_amount numeric,vat_amount numeric,journal_status text,entry_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT b.posting_day,b.site,b.provider,b.source_count,b.gross_amount,b.vat_amount,
    e.status,e.id FROM public.rivhit_daily_journal_batches b
  JOIN public.rivhit_journal_entries e ON e.batch_id=b.id
  WHERE (p_day IS NULL OR b.posting_day=p_day)
    AND auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p
      WHERE p.id=auth.uid() AND p.role::text='admin')
  ORDER BY b.posting_day DESC,b.site,b.provider,b.created_at
$$;
REVOKE ALL ON FUNCTION public.rivhit_daily_batch_status(date)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rivhit_daily_batch_status(date) TO authenticated;

COMMIT;
