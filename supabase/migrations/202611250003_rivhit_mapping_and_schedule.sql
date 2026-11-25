-- Preparation only: no approved mappings, capture, or posting are enabled.
BEGIN;

ALTER TABLE public.rivhit_journal_approved_mappings
  ADD COLUMN sort_code integer,
  ADD COLUMN debit_account integer,
  ADD COLUMN credit_account integer,
  ADD COLUMN vat_rate_basis_points integer,
  ADD COLUMN project_id integer,
  ADD COLUMN enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.rivhit_journal_approved_mappings
  ADD CONSTRAINT rivhit_mapping_accounts_valid CHECK (
    NOT enabled OR (sort_code IS NOT NULL AND debit_account IS NOT NULL
    AND credit_account IS NOT NULL AND vat_rate_basis_points IS NOT NULL
    AND sort_code > 0 AND debit_account > 0 AND credit_account > 0
    AND vat_rate_basis_points BETWEEN 0 AND 10000
    AND (project_id IS NULL OR project_id > 0)));

-- Scheduling is deliberately inert until the posting mode and aggregation
-- contract are approved. Cron may wake the worker more frequently than this.
ALTER TABLE public.rivhit_journal_control
  ADD COLUMN posting_cadence text NOT NULL DEFAULT 'manual'
    CHECK (posting_cadence IN ('manual','per_transaction','daily','periodic')),
  ADD COLUMN posting_time_israel time,
  ADD COLUMN posting_day_of_month integer
    CHECK (posting_day_of_month BETWEEN 1 AND 28),
  ADD CONSTRAINT rivhit_posting_schedule_valid CHECK (
    (posting_cadence='manual' AND posting_time_israel IS NULL AND posting_day_of_month IS NULL)
    OR (posting_cadence='per_transaction' AND posting_day_of_month IS NULL)
    OR (posting_cadence='daily' AND posting_time_israel IS NOT NULL AND posting_day_of_month IS NULL)
    OR (posting_cadence='periodic' AND posting_time_israel IS NOT NULL AND posting_day_of_month IS NOT NULL));

-- Existing source and entry rows are not changed. A mode that might require
-- aggregation cannot dispatch one entry per document by mistake.
CREATE FUNCTION public.rivhit_journal_posting_window_open() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT c.capture_enabled AND c.posting_enabled
    AND c.posting_cadence='per_transaction' AND c.cutover_at IS NOT NULL
    FROM public.rivhit_journal_control c WHERE c.singleton),false)
$$;
REVOKE ALL ON FUNCTION public.rivhit_journal_posting_window_open()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rivhit_journal_posting_window_open() TO service_role;

CREATE FUNCTION public.enforce_rivhit_approved_mapping() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.rivhit_journal_approved_mappings%ROWTYPE;
  facts jsonb; gross_minor numeric; vat_minor numeric;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.status='reserved' AND OLD.status='ready' AND
      NOT public.rivhit_journal_posting_window_open() THEN
      RAISE EXCEPTION 'rivhit_journal_posting_schedule_closed' USING ERRCODE='42501';
    END IF;
    IF NEW.status<>'reserved' OR OLD.status<>'ready' THEN RETURN NEW; END IF;
  END IF;
  SELECT s.source_facts INTO facts FROM public.rivhit_journal_sources s
    WHERE s.id=NEW.source_id;
  SELECT * INTO m FROM public.rivhit_journal_approved_mappings a
    WHERE a.provider=facts->>'provider' AND a.site=facts->>'site'
      AND a.mapping_version=NEW.mapping_version AND a.enabled;
  IF NOT FOUND OR NEW.request_payload->>'sort_code' IS DISTINCT FROM m.sort_code::text
    OR NEW.request_payload->>'customer_id_debit' IS DISTINCT FROM m.debit_account::text
    OR NEW.request_payload->>'customer_id_credit' IS DISTINCT FROM m.credit_account::text
    OR NEW.request_payload->>'project_id' IS DISTINCT FROM m.project_id::text
  THEN RAISE EXCEPTION 'rivhit_journal_mapping_not_approved' USING ERRCODE='42501'; END IF;
  gross_minor:=pg_catalog.round((facts->>'amount')::numeric*100);
  vat_minor:=pg_catalog.round(gross_minor*m.vat_rate_basis_points/
    (10000+m.vat_rate_basis_points));
  IF NEW.expected_vat IS DISTINCT FROM vat_minor/100 THEN
    RAISE EXCEPTION 'rivhit_journal_vat_mapping_mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enforce_rivhit_mapping_insert BEFORE INSERT
  ON public.rivhit_journal_entries FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rivhit_approved_mapping();
CREATE TRIGGER trg_enforce_rivhit_mapping_reserve BEFORE UPDATE OF status
  ON public.rivhit_journal_entries FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rivhit_approved_mapping();
REVOKE ALL ON FUNCTION public.enforce_rivhit_approved_mapping()
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
