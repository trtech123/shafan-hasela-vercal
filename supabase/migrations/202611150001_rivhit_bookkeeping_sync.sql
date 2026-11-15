-- Local-only draft. Do not apply to Production until migration history is reconciled.
-- This outbox never reads or releases the legacy accounting_events queue.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';
CREATE TABLE public.rivhit_bookkeeping_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_namespace text NOT NULL CHECK (btrim(account_namespace) <> ''),
  source_system text NOT NULL CHECK (source_system = 'payper'),
  source_document_id text NOT NULL CHECK (btrim(source_document_id) <> ''),
  document_number text NOT NULL CHECK (btrim(document_number) <> ''),
  document_type text NOT NULL CHECK (btrim(document_type) <> ''),
  payment_id uuid NOT NULL,
  sale_id uuid,
  issued_at timestamptz NOT NULL,
  gross_minor bigint NOT NULL CHECK (gross_minor > 0),
  currency text NOT NULL CHECK (currency = 'ILS'),
  source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_namespace, source_system, source_document_id)
);

CREATE TABLE public.rivhit_bookkeeping_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.rivhit_bookkeeping_sources(id),
  leg_kind text NOT NULL CHECK (leg_kind IN ('invoice', 'receipt', 'reversal')),
  correction_sequence integer NOT NULL DEFAULT 0 CHECK (correction_sequence >= 0),
  status text NOT NULL DEFAULT 'held_mapping' CHECK (status IN
    ('held_mapping', 'ready', 'processing', 'succeeded', 'reconciliation_required', 'permanent_error')),
  mapping_version text,
  mapping_approval_ref text,
  request_reference text NOT NULL CHECK (btrim(request_reference) <> ''),
  frozen_request jsonb,
  request_hash text CHECK (request_hash IS NULL OR request_hash ~ '^[a-f0-9]{64}$'),
  dispatch_started_at timestamptz,
  claim_token uuid,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  journal_year integer,
  journal_month integer,
  journal_line integer,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, leg_kind, correction_sequence),
  UNIQUE (request_reference),
  CHECK (status <> 'ready' OR
    (mapping_version IS NOT NULL AND btrim(mapping_version) <> ''
      AND mapping_approval_ref IS NOT NULL AND btrim(mapping_approval_ref) <> ''
      AND frozen_request IS NOT NULL AND jsonb_typeof(frozen_request) = 'object'
      AND request_hash IS NOT NULL AND dispatch_started_at IS NULL)),
  CHECK (status <> 'succeeded' OR
    (journal_year > 0 AND journal_month BETWEEN 1 AND 12 AND journal_line > 0))
);

CREATE INDEX rivhit_bookkeeping_legs_status_idx
  ON public.rivhit_bookkeeping_legs (status, created_at);

CREATE FUNCTION public.guard_rivhit_bookkeeping_source()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'bookkeeping_source_immutable';
END;
$$;
CREATE TRIGGER rivhit_bookkeeping_source_immutable
  BEFORE UPDATE OR DELETE ON public.rivhit_bookkeeping_sources
  FOR EACH ROW EXECUTE FUNCTION public.guard_rivhit_bookkeeping_source();

CREATE FUNCTION public.guard_rivhit_bookkeeping_leg()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.dispatch_started_at IS NOT NULL AND
    (NEW.source_id, NEW.leg_kind, NEW.correction_sequence,
     NEW.request_reference, NEW.frozen_request, NEW.request_hash,
     NEW.mapping_version, NEW.mapping_approval_ref)
    IS DISTINCT FROM
    (OLD.source_id, OLD.leg_kind, OLD.correction_sequence,
     OLD.request_reference, OLD.frozen_request, OLD.request_hash,
     OLD.mapping_version, OLD.mapping_approval_ref) THEN
    RAISE EXCEPTION 'dispatched_bookkeeping_leg_immutable';
  END IF;
  IF OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at THEN
    RAISE EXCEPTION 'bookkeeping_dispatch_cannot_be_reset';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rivhit_bookkeeping_leg_guard
  BEFORE UPDATE ON public.rivhit_bookkeeping_legs
  FOR EACH ROW EXECUTE FUNCTION public.guard_rivhit_bookkeeping_leg();

ALTER TABLE public.rivhit_bookkeeping_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rivhit_bookkeeping_legs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rivhit_bookkeeping_sources, public.rivhit_bookkeeping_legs FROM anon, authenticated;
GRANT SELECT, INSERT ON public.rivhit_bookkeeping_sources TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.rivhit_bookkeeping_legs TO service_role;

-- Only these functions mutate a claimed leg. A dispatch is never automatically reclaimed.
CREATE FUNCTION public.claim_rivhit_bookkeeping_leg(
  p_id uuid, p_mapping_version text, p_approval_ref text, p_account_namespace text)
RETURNS TABLE (leg_id uuid, claim_token uuid, frozen_request jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_token uuid := gen_random_uuid();
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  RETURN QUERY
  UPDATE public.rivhit_bookkeeping_legs AS l
  SET status = 'processing', claim_token = v_token,
      dispatch_started_at = now(), attempt_count = l.attempt_count + 1,
      updated_at = now()
  FROM public.rivhit_bookkeeping_sources AS s
  WHERE l.id = p_id AND l.source_id = s.id
    AND s.account_namespace = p_account_namespace
    AND l.mapping_version = p_mapping_version
    AND l.mapping_approval_ref = p_approval_ref
    AND l.status = 'ready' AND l.dispatch_started_at IS NULL
    AND l.mapping_approval_ref IS NOT NULL AND l.frozen_request IS NOT NULL
    AND (s.document_type <> 'invoice_receipt' OR l.leg_kind <> 'receipt' OR
      EXISTS (SELECT 1 FROM public.rivhit_bookkeeping_legs AS first_leg
        WHERE first_leg.source_id = l.source_id AND first_leg.leg_kind = 'invoice'
          AND first_leg.correction_sequence = l.correction_sequence
          AND first_leg.status = 'succeeded'))
  RETURNING l.id, l.claim_token, l.frozen_request;
END;
$$;

CREATE FUNCTION public.complete_rivhit_bookkeeping_leg(
  p_id uuid, p_claim_token uuid, p_year integer, p_month integer, p_line integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_year <= 0 OR p_month NOT BETWEEN 1 AND 12 OR p_line <= 0 THEN
    RAISE EXCEPTION 'invalid_journal_identity';
  END IF;
  UPDATE public.rivhit_bookkeeping_legs
  SET status = 'succeeded', journal_year = p_year, journal_month = p_month,
      journal_line = p_line, claim_token = NULL, updated_at = now()
  WHERE id = p_id AND claim_token = p_claim_token AND status = 'processing';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

CREATE FUNCTION public.hold_rivhit_bookkeeping_leg(p_id uuid, p_claim_token uuid, p_error_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  UPDATE public.rivhit_bookkeeping_legs
  SET status = 'reconciliation_required', claim_token = NULL,
      last_error_code = left(coalesce(p_error_code, 'unknown_outcome'), 80), updated_at = now()
  WHERE id = p_id AND claim_token = p_claim_token AND status = 'processing';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_rivhit_bookkeeping_leg(uuid,text,text,text),
  public.complete_rivhit_bookkeeping_leg(uuid,uuid,integer,integer,integer),
  public.hold_rivhit_bookkeeping_leg(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rivhit_bookkeeping_leg(uuid,text,text,text),
  public.complete_rivhit_bookkeeping_leg(uuid,uuid,integer,integer,integer),
  public.hold_rivhit_bookkeeping_leg(uuid,uuid,text) TO service_role;
COMMIT;
