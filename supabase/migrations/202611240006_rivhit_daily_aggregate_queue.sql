-- Future-only daily aggregate preparation. Capture and posting stay disabled.
-- A batch may contain several finalized Payper documents, but each source may
-- belong to exactly one batch. Later finalized documents can form a separate
-- batch for the same accounting group before midnight Israel time.
BEGIN;

ALTER TABLE public.rivhit_journal_sources
  ADD COLUMN defer_reason text CHECK (defer_reason IN
    ('site_mapping_unapproved','activity_site_unresolved','source_evidence_incomplete',
     'daily_stage_failed','capacity_exceeded')),
  ADD COLUMN deferred_at timestamptz;

-- Every defer records a bounded operational reason. A failed staging RPC may
-- be attempted again safely because it never calls Rivhit; posting uncertainty
-- is handled separately by read-back, never by a second AddJournal call.
CREATE FUNCTION public.defer_rivhit_daily_sources(p_source_ids uuid[],p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed integer;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_source_ids IS NULL OR pg_catalog.cardinality(p_source_ids) NOT BETWEEN 1 AND 501
    OR p_reason NOT IN ('site_mapping_unapproved','activity_site_unresolved','source_evidence_incomplete',
    'daily_stage_failed','capacity_exceeded') THEN
    RAISE EXCEPTION 'daily_defer_reason_invalid' USING ERRCODE='22023'; END IF;
  UPDATE public.rivhit_journal_sources SET defer_reason=p_reason,
    deferred_at=pg_catalog.clock_timestamp(),
    next_mapping_check_at=pg_catalog.clock_timestamp()+
      CASE WHEN p_reason='daily_stage_failed' THEN INTERVAL '1 minute'
        ELSE INTERVAL '15 minutes' END
  WHERE id=ANY(p_source_ids) AND state='mapping_required';
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.defer_rivhit_daily_sources(uuid[],text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.defer_rivhit_daily_sources(uuid[],text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.defer_rivhit_journal_source(uuid) FROM service_role;

ALTER TABLE public.rivhit_journal_control
  ADD CONSTRAINT rivhit_daily_close_time CHECK (posting_cadence<>'daily'
    OR posting_time_israel BETWEEN TIME '23:00' AND TIME '23:30:00');

CREATE TABLE public.rivhit_daily_journal_batches (
  id uuid PRIMARY KEY,
  posting_day date NOT NULL,
  provider text NOT NULL CHECK (provider IN ('pelecard','manual_cash','manual_check')),
  site text NOT NULL,
  mapping_version text NOT NULL,
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

-- Historical shared catalog activities are allowed through ordinary checkout,
-- but their documents cannot be auto-classified until the activity's saved
-- site matches the immutable payment site. Check both order and POS lines.
CREATE FUNCTION public.rivhit_source_activity_site_resolved(
  p_payment_id uuid,p_site text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE payment public.payment_transactions%ROWTYPE;
  ord public.orders%ROWTYPE;
  line jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO payment FROM public.payment_transactions WHERE id=p_payment_id;
  IF payment.id IS NULL OR p_site IS NULL THEN RETURN false; END IF;
  IF payment.order_id IS NOT NULL THEN
    SELECT * INTO ord FROM public.orders WHERE id=payment.order_id;
    IF ord.id IS NULL THEN RETURN false; END IF;
    IF ord.activity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.activities a
      WHERE a.id=ord.activity_id AND a.site=p_site) THEN RETURN false; END IF;
    IF pg_catalog.jsonb_typeof(ord.quotation_snapshot->'selected_activities')='array' THEN
      FOR line IN SELECT value FROM pg_catalog.jsonb_array_elements(
        ord.quotation_snapshot->'selected_activities') LOOP
        IF line->>'item_type'='activity' AND line->>'activity_id' IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.activities a
            WHERE a.id::text=line->>'activity_id' AND a.site=p_site)
        THEN RETURN false; END IF;
      END LOOP;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(payment.checkout_snapshot->'items')='array'
        THEN payment.checkout_snapshot->'items' ELSE '[]'::jsonb END) item
      JOIN public.activities a ON a.id::text=item.value->>'id'
      WHERE a.site IS DISTINCT FROM p_site) THEN RETURN false;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.rivhit_source_activity_site_resolved(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rivhit_source_activity_site_resolved(uuid,text)
  TO service_role;

-- The database clock owns the closing window, including DST transitions.
-- The configured time starts the daily run; new same-day documents remain
-- eligible until midnight. Unfinished prior-day work is explicitly overdue.
CREATE FUNCTION public.rivhit_daily_eligible_sources(p_day date,p_limit integer)
RETURNS TABLE (id uuid,payper_document_number text,source_facts jsonb,captured_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_day IS DISTINCT FROM
    (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date
    OR p_limit NOT BETWEEN 1 AND 501 THEN
    RAISE EXCEPTION 'daily_source_filter_invalid' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT s.id,s.payper_document_number,
    pg_catalog.jsonb_set(s.source_facts,'{activitySiteResolved}',
      pg_catalog.to_jsonb(public.rivhit_source_activity_site_resolved(
        s.payment_id,s.source_facts->>'site')),true),s.captured_at
    FROM public.rivhit_journal_sources s
    JOIN public.rivhit_journal_control c ON c.singleton
    WHERE c.capture_enabled AND c.posting_cadence='daily'
      AND c.cutover_at IS NOT NULL AND s.captured_at>=c.cutover_at
      AND s.state='mapping_required'
      AND s.next_mapping_check_at<=pg_catalog.clock_timestamp()
      AND (s.captured_at AT TIME ZONE 'Asia/Jerusalem')::date = p_day
    ORDER BY s.next_mapping_check_at,s.id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.rivhit_daily_eligible_sources(date,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rivhit_daily_eligible_sources(date,integer)
  TO service_role;

-- Resolve a lost staging HTTP response from durable membership before any
-- defer or another provider operation. A partial membership is impossible
-- because staging commits atomically, so it returns NULL on inconsistent data.
CREATE FUNCTION public.rivhit_daily_batch_for_sources(p_source_ids uuid[])
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE batch_value uuid;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_source_ids IS NULL OR pg_catalog.cardinality(p_source_ids) NOT BETWEEN 1 AND 500
    THEN RAISE EXCEPTION 'daily_source_filter_invalid' USING ERRCODE='22023'; END IF;
  SELECT min(m.batch_id::text)::uuid INTO batch_value
    FROM public.rivhit_daily_journal_members m
    WHERE m.source_id=ANY(p_source_ids)
    HAVING count(DISTINCT m.source_id)=pg_catalog.cardinality(p_source_ids)
      AND count(DISTINCT m.batch_id)=1;
  RETURN batch_value;
END $$;
REVOKE ALL ON FUNCTION public.rivhit_daily_batch_for_sources(uuid[])
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rivhit_daily_batch_for_sources(uuid[]) TO service_role;

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
  IF TG_OP='UPDATE' AND b.posting_day IS DISTINCT FROM
    (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date THEN
    RAISE EXCEPTION 'rivhit_daily_deadline_missed' USING ERRCODE='42501'; END IF;
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
  IF coalesce(auth.role(),'')<>'service_role' THEN
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
    AND (s.captured_at AT TIME ZONE 'Asia/Jerusalem')::date = p_posting_day
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
  -- A legacy activity without a single saved site cannot be classified from
  -- the order's chosen location alone. Leave its payment out of auto-posting.
  IF EXISTS (SELECT 1 FROM public.rivhit_journal_sources src
    WHERE src.id=ANY(p_source_ids)
      AND NOT public.rivhit_source_activity_site_resolved(
        src.payment_id,src.source_facts->>'site')) THEN
    RAISE EXCEPTION 'rivhit_activity_site_unresolved' USING ERRCODE='42501'; END IF;
  -- Source membership is unique. A bounded page can be posted now; later
  -- finalized sources form a separate batch with a distinct provider reference.
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
  UPDATE public.rivhit_journal_sources SET state='mapped',
    defer_reason=NULL,deferred_at=NULL
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
