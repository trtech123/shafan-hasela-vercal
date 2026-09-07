-- ============================================================
-- Migration 021: Clubs, memberships, and iCredit reconciliation
-- Additive only. Does not alter orders/activities or create documents.
-- ============================================================

CREATE TABLE public.clubs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  description         TEXT,
  instructor_id       UUID REFERENCES public.instructors(id) ON DELETE SET NULL,
  site                TEXT,
  capacity            INTEGER CHECK (capacity IS NULL OR capacity > 0),
  monthly_price       NUMERIC(10,2) NOT NULL CHECK (monthly_price >= 0),
  currency            TEXT NOT NULL DEFAULT 'ILS' CHECK (currency = 'ILS'),
  default_billing_day SMALLINT NOT NULL DEFAULT 1 CHECK (default_billing_day BETWEEN 1 AND 28),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  notes               TEXT,
  created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.club_schedule_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id         UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  effective_from  DATE,
  effective_until DATE,
  timezone        TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from)
);

CREATE TABLE public.club_sessions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id          UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  schedule_rule_id UUID REFERENCES public.club_schedule_rules(id) ON DELETE SET NULL,
  session_date     DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  notes            TEXT,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time),
  UNIQUE (club_id, session_date, start_time)
);

CREATE TABLE public.club_participants (
  id                           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name                   TEXT NOT NULL CHECK (length(btrim(first_name)) > 0),
  last_name                    TEXT NOT NULL CHECK (length(btrim(last_name)) > 0),
  birth_date                   DATE,
  phone                        TEXT,
  email                        TEXT,
  primary_contact_name         TEXT,
  primary_contact_relationship TEXT,
  primary_contact_phone        TEXT,
  primary_contact_email        TEXT,
  notes                        TEXT,
  created_by                   UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.club_memberships (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id                   UUID NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  participant_id            UUID NOT NULL REFERENCES public.club_participants(id) ON DELETE RESTRICT,
  registered_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  starts_on                 DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on                   DATE,
  monthly_price             NUMERIC(10,2) NOT NULL CHECK (monthly_price >= 0),
  currency                  TEXT NOT NULL DEFAULT 'ILS' CHECK (currency = 'ILS'),
  billing_day               SMALLINT NOT NULL CHECK (billing_day BETWEEN 1 AND 28),
  status                    TEXT NOT NULL DEFAULT 'pending_enrollment' CHECK (
    status IN ('pending_enrollment', 'active', 'paused', 'cancelled', 'ended')
  ),
  payment_status            TEXT NOT NULL DEFAULT 'not_enrolled' CHECK (
    payment_status IN ('not_enrolled', 'enrollment_pending', 'current', 'past_due', 'cancelled')
  ),
  debt_amount               NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (debt_amount >= 0),
  cancellation_requested_at TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  cancellation_effective_on DATE,
  notes                     TEXT,
  created_by                UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE UNIQUE INDEX one_open_club_membership
  ON public.club_memberships (club_id, participant_id)
  WHERE status IN ('pending_enrollment', 'active', 'paused');

CREATE TABLE public.recurring_agreements (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  membership_id             UUID NOT NULL UNIQUE REFERENCES public.club_memberships(id) ON DELETE RESTRICT,
  provider                  TEXT NOT NULL DEFAULT 'icredit' CHECK (provider = 'icredit'),
  provider_environment      TEXT NOT NULL DEFAULT 'test' CHECK (provider_environment IN ('test', 'production')),
  status                    TEXT NOT NULL DEFAULT 'pending_enrollment' CHECK (
    status IN ('pending_enrollment', 'active', 'cancellation_pending', 'provider_cancelled', 'cancelled', 'failed')
  ),
  provider_recurring_id     UUID,
  provider_sale_id          UUID,
  provider_request_reference TEXT NOT NULL UNIQUE,
  recurring_cycle           SMALLINT NOT NULL DEFAULT 3 CHECK (recurring_cycle = 3),
  recurring_step            SMALLINT NOT NULL DEFAULT 1 CHECK (recurring_step = 1),
  recurring_day             SMALLINT NOT NULL CHECK (recurring_day BETWEEN 1 AND 28),
  recurring_count           INTEGER NOT NULL DEFAULT 0 CHECK (recurring_count = 0),
  starts_on                 DATE NOT NULL,
  last_charge_number        INTEGER NOT NULL DEFAULT 0 CHECK (last_charge_number >= 0),
  activated_at              TIMESTAMPTZ,
  cancellation_requested_at TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  compensation_required_at  TIMESTAMPTZ,
  compensated_at            TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_recurring_id),
  UNIQUE (provider, provider_sale_id)
);

CREATE TABLE public.recurring_charges (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agreement_id           UUID NOT NULL REFERENCES public.recurring_agreements(id) ON DELETE RESTRICT,
  provider               TEXT NOT NULL DEFAULT 'icredit' CHECK (provider = 'icredit'),
  provider_sale_id       UUID NOT NULL,
  provider_charge_number INTEGER NOT NULL CHECK (provider_charge_number > 0),
  amount                 NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  currency               TEXT NOT NULL DEFAULT 'ILS' CHECK (currency = 'ILS'),
  status                 TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  failure_code           TEXT,
  failure_message        TEXT,
  charged_at             TIMESTAMPTZ,
  failed_at              TIMESTAMPTZ,
  resolved_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_sale_id),
  UNIQUE (agreement_id, provider_charge_number)
);

CREATE TABLE public.club_attendance (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id    UUID NOT NULL REFERENCES public.club_sessions(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES public.club_memberships(id) ON DELETE RESTRICT,
  status        TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'excused')),
  notes         TEXT,
  recorded_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, membership_id)
);

CREATE TABLE public.payment_webhook_events (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider               TEXT NOT NULL DEFAULT 'icredit' CHECK (provider = 'icredit'),
  event_digest           TEXT NOT NULL UNIQUE CHECK (event_digest ~ '^[0-9a-f]{64}$'),
  agreement_id           UUID NOT NULL REFERENCES public.recurring_agreements(id) ON DELETE RESTRICT,
  event_kind             TEXT NOT NULL CHECK (event_kind IN ('agreement_created', 'charge_succeeded', 'charge_failed')),
  provider_sale_id       UUID NOT NULL,
  provider_recurring_id  UUID NOT NULL,
  provider_charge_number INTEGER NOT NULL CHECK (provider_charge_number >= 0),
  processing_status      TEXT NOT NULL DEFAULT 'processed' CHECK (processing_status IN ('processed', 'ignored')),
  received_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_club_schedule_rules_club ON public.club_schedule_rules (club_id);
CREATE INDEX idx_club_sessions_club_date ON public.club_sessions (club_id, session_date);
CREATE INDEX idx_club_memberships_club ON public.club_memberships (club_id);
CREATE INDEX idx_club_memberships_participant ON public.club_memberships (participant_id);
CREATE INDEX idx_recurring_charges_agreement_status ON public.recurring_charges (agreement_id, status);
CREATE INDEX idx_payment_webhook_events_agreement ON public.payment_webhook_events (agreement_id, received_at DESC);

CREATE TRIGGER trg_clubs_updated_at BEFORE UPDATE ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_club_schedule_rules_updated_at BEFORE UPDATE ON public.club_schedule_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_club_sessions_updated_at BEFORE UPDATE ON public.club_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_club_participants_updated_at BEFORE UPDATE ON public.club_participants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_club_memberships_updated_at BEFORE UPDATE ON public.club_memberships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_recurring_agreements_updated_at BEFORE UPDATE ON public.recurring_agreements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_recurring_charges_updated_at BEFORE UPDATE ON public.recurring_charges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_club_attendance_updated_at BEFORE UPDATE ON public.club_attendance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_schedule_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clubs: admin read" ON public.clubs FOR SELECT USING (public.is_admin());
CREATE POLICY "clubs: admin insert" ON public.clubs FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "clubs: admin update" ON public.clubs FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "clubs: admin delete" ON public.clubs FOR DELETE USING (public.is_admin());

CREATE POLICY "club schedule: admin read" ON public.club_schedule_rules FOR SELECT USING (public.is_admin());
CREATE POLICY "club schedule: admin insert" ON public.club_schedule_rules FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "club schedule: admin update" ON public.club_schedule_rules FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "club schedule: admin delete" ON public.club_schedule_rules FOR DELETE USING (public.is_admin());

CREATE POLICY "club sessions: admin read" ON public.club_sessions FOR SELECT USING (public.is_admin());
CREATE POLICY "club sessions: admin insert" ON public.club_sessions FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "club sessions: admin update" ON public.club_sessions FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "club sessions: admin delete" ON public.club_sessions FOR DELETE USING (public.is_admin());

CREATE POLICY "club participants: admin read" ON public.club_participants FOR SELECT USING (public.is_admin());
CREATE POLICY "club participants: admin insert" ON public.club_participants FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "club participants: admin update" ON public.club_participants FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "club participants: admin delete" ON public.club_participants FOR DELETE USING (public.is_admin());

CREATE POLICY "club memberships: admin read" ON public.club_memberships FOR SELECT USING (public.is_admin());
CREATE POLICY "club memberships: admin insert" ON public.club_memberships FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "club memberships: admin update" ON public.club_memberships FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "club memberships: admin delete" ON public.club_memberships FOR DELETE USING (public.is_admin());

CREATE POLICY "recurring agreements: admin read" ON public.recurring_agreements FOR SELECT USING (public.is_admin());
CREATE POLICY "recurring charges: admin read" ON public.recurring_charges FOR SELECT USING (public.is_admin());
CREATE POLICY "payment webhooks: admin read" ON public.payment_webhook_events FOR SELECT USING (public.is_admin());

CREATE POLICY "club attendance: admin read" ON public.club_attendance FOR SELECT USING (public.is_admin());
CREATE POLICY "club attendance: admin insert" ON public.club_attendance FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "club attendance: admin update" ON public.club_attendance FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "club attendance: admin delete" ON public.club_attendance FOR DELETE USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clubs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_schedule_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_attendance TO authenticated;
GRANT SELECT ON public.recurring_agreements, public.recurring_charges, public.payment_webhook_events TO authenticated;

REVOKE ALL ON public.recurring_agreements FROM anon, authenticated;
REVOKE ALL ON public.recurring_charges FROM anon, authenticated;
REVOKE ALL ON public.payment_webhook_events FROM anon, authenticated;
GRANT SELECT ON public.recurring_agreements, public.recurring_charges, public.payment_webhook_events TO authenticated;

CREATE OR REPLACE FUNCTION public.save_club_with_schedule(
  p_club_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_instructor_id UUID,
  p_site TEXT,
  p_capacity INTEGER,
  p_monthly_price NUMERIC,
  p_default_billing_day SMALLINT,
  p_status TEXT,
  p_notes TEXT,
  p_rules JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_club_id UUID;
  v_rule JSONB;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin required'; END IF;
  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'array' OR jsonb_array_length(p_rules) = 0 THEN
    RAISE EXCEPTION 'at least one schedule rule is required';
  END IF;

  IF p_club_id IS NULL THEN
    INSERT INTO public.clubs (
      name, description, instructor_id, site, capacity, monthly_price,
      default_billing_day, status, notes
    ) VALUES (
      p_name, p_description, p_instructor_id, p_site, p_capacity, p_monthly_price,
      p_default_billing_day, p_status, p_notes
    ) RETURNING id INTO v_club_id;
  ELSE
    UPDATE public.clubs
    SET name = p_name,
        description = p_description,
        instructor_id = p_instructor_id,
        site = p_site,
        capacity = p_capacity,
        monthly_price = p_monthly_price,
        default_billing_day = p_default_billing_day,
        status = p_status,
        notes = p_notes
    WHERE id = p_club_id
    RETURNING id INTO v_club_id;
    IF v_club_id IS NULL THEN RAISE EXCEPTION 'club not found'; END IF;
    DELETE FROM public.club_schedule_rules WHERE club_id = v_club_id;
  END IF;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(p_rules)
  LOOP
    INSERT INTO public.club_schedule_rules (
      club_id, weekday, start_time, end_time, effective_from, effective_until,
      timezone, is_active
    ) VALUES (
      v_club_id,
      (v_rule->>'weekday')::SMALLINT,
      (v_rule->>'start_time')::TIME,
      (v_rule->>'end_time')::TIME,
      NULLIF(v_rule->>'effective_from', '')::DATE,
      NULLIF(v_rule->>'effective_until', '')::DATE,
      COALESCE(NULLIF(v_rule->>'timezone', ''), 'Asia/Jerusalem'),
      COALESCE((v_rule->>'is_active')::BOOLEAN, TRUE)
    );
  END LOOP;

  RETURN v_club_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_icredit_recurring_enrollment(
  p_membership_id UUID,
  p_agreement_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_membership public.club_memberships%ROWTYPE;
  v_agreement public.recurring_agreements%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  SELECT * INTO v_membership
  FROM public.club_memberships
  WHERE id = p_membership_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'membership not found'; END IF;
  IF v_membership.status IN ('cancelled', 'ended') THEN
    RAISE EXCEPTION 'membership cannot be enrolled';
  END IF;

  SELECT * INTO v_agreement
  FROM public.recurring_agreements
  WHERE membership_id = p_membership_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_agreement.status <> 'pending_enrollment' THEN
      RAISE EXCEPTION 'recurring agreement cannot be enrolled';
    END IF;
  ELSE
    INSERT INTO public.recurring_agreements (
      id, membership_id, provider_environment, provider_request_reference,
      recurring_day, starts_on
    ) VALUES (
      p_agreement_id, p_membership_id, 'test', 'club:' || p_agreement_id::TEXT,
      v_membership.billing_day, v_membership.starts_on
    ) RETURNING * INTO v_agreement;
  END IF;

  UPDATE public.club_memberships
  SET payment_status = 'enrollment_pending'
  WHERE id = p_membership_id;

  RETURN jsonb_build_object('agreement_id', v_agreement.id, 'status', v_agreement.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_icredit_recurring_event(
  p_agreement_id UUID,
  p_event_digest TEXT,
  p_event_kind TEXT,
  p_provider_sale_id UUID,
  p_provider_recurring_id UUID,
  p_provider_charge_number INTEGER,
  p_amount NUMERIC,
  p_failure_code TEXT DEFAULT NULL,
  p_failure_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agreement public.recurring_agreements%ROWTYPE;
  v_membership public.club_memberships%ROWTYPE;
  v_inserted_event UUID;
  v_charge_id UUID;
  v_debt NUMERIC(10,2);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  IF p_event_kind NOT IN ('agreement_created', 'charge_succeeded', 'charge_failed') THEN
    RAISE EXCEPTION 'invalid event kind';
  END IF;
  IF p_event_kind = 'agreement_created' AND p_provider_charge_number <> 0 THEN
    RAISE EXCEPTION 'creation charge number must be zero';
  END IF;

  SELECT * INTO v_agreement
  FROM public.recurring_agreements
  WHERE id = p_agreement_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'agreement not found'; END IF;
  IF v_agreement.provider_environment <> 'test' THEN RAISE EXCEPTION 'test agreement required'; END IF;
  IF v_agreement.provider_recurring_id IS NOT NULL
     AND v_agreement.provider_recurring_id <> p_provider_recurring_id THEN
    RAISE EXCEPTION 'provider recurring id mismatch';
  END IF;

  SELECT * INTO v_membership
  FROM public.club_memberships
  WHERE id = v_agreement.membership_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'membership not found'; END IF;
  IF v_membership.status IN ('cancelled', 'ended') AND v_agreement.status <> 'cancelled' THEN
    RAISE EXCEPTION 'terminal membership cannot be activated';
  END IF;
  IF round(v_membership.monthly_price, 2) <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'amount mismatch';
  END IF;
  IF v_agreement.status = 'cancelled' AND p_event_kind <> 'agreement_created' THEN
    RAISE EXCEPTION 'cancelled agreement cannot accept charge events';
  END IF;

  INSERT INTO public.payment_webhook_events (
    event_digest, agreement_id, event_kind, provider_sale_id,
    provider_recurring_id, provider_charge_number, processing_status
  ) VALUES (
    p_event_digest, p_agreement_id, p_event_kind, p_provider_sale_id,
    p_provider_recurring_id, p_provider_charge_number,
    CASE WHEN p_event_kind = 'agreement_created' AND v_agreement.status <> 'pending_enrollment'
      THEN 'ignored' ELSE 'processed' END
  )
  ON CONFLICT (event_digest) DO NOTHING
  RETURNING id INTO v_inserted_event;

  IF v_inserted_event IS NULL THEN
    RETURN jsonb_build_object(
      'duplicate', true,
      'agreement_id', p_agreement_id,
      'compensation_required',
        v_agreement.compensation_required_at IS NOT NULL
        AND v_agreement.compensated_at IS NULL
    );
  END IF;

  IF p_event_kind = 'agreement_created' AND v_agreement.status <> 'pending_enrollment' THEN
    IF v_agreement.status = 'cancelled' AND v_agreement.activated_at IS NULL THEN
      UPDATE public.recurring_agreements
      SET provider_recurring_id = COALESCE(provider_recurring_id, p_provider_recurring_id),
          provider_sale_id = COALESCE(provider_sale_id, p_provider_sale_id),
          compensation_required_at = COALESCE(compensation_required_at, NOW())
      WHERE id = p_agreement_id;
    END IF;
    RETURN jsonb_build_object(
      'duplicate', false,
      'ignored', true,
      'agreement_id', p_agreement_id,
      'compensation_required',
        v_agreement.status = 'cancelled'
        AND v_agreement.activated_at IS NULL
        AND v_agreement.compensated_at IS NULL
    );
  END IF;

  IF p_event_kind = 'agreement_created' THEN
    UPDATE public.recurring_agreements
    SET provider_recurring_id = p_provider_recurring_id,
        provider_sale_id = COALESCE(provider_sale_id, p_provider_sale_id),
        status = 'active', activated_at = COALESCE(activated_at, NOW())
    WHERE id = p_agreement_id;

    UPDATE public.club_memberships
    SET status = 'active', payment_status = CASE WHEN debt_amount > 0 THEN 'past_due' ELSE 'current' END
    WHERE id = v_membership.id;

    RETURN jsonb_build_object('duplicate', false, 'agreement_id', p_agreement_id, 'kind', p_event_kind);
  END IF;

  IF p_provider_charge_number <= 0 THEN RAISE EXCEPTION 'charge number must be positive'; END IF;
  IF v_agreement.provider_recurring_id IS NULL THEN RAISE EXCEPTION 'agreement is not active'; END IF;

  INSERT INTO public.recurring_charges (
    agreement_id, provider_sale_id, provider_charge_number, amount, status,
    failure_code, failure_message, charged_at, failed_at
  ) VALUES (
    p_agreement_id, p_provider_sale_id, p_provider_charge_number, p_amount,
    CASE WHEN p_event_kind = 'charge_succeeded' THEN 'succeeded' ELSE 'failed' END,
    CASE WHEN p_event_kind = 'charge_failed' THEN left(p_failure_code, 100) END,
    CASE WHEN p_event_kind = 'charge_failed' THEN left(p_failure_message, 500) END,
    CASE WHEN p_event_kind = 'charge_succeeded' THEN NOW() END,
    CASE WHEN p_event_kind = 'charge_failed' THEN NOW() END
  )
  ON CONFLICT (agreement_id, provider_charge_number) DO UPDATE
  SET provider_sale_id = EXCLUDED.provider_sale_id,
      status = CASE
        WHEN public.recurring_charges.status = 'succeeded' THEN 'succeeded'
        ELSE EXCLUDED.status
      END,
      failure_code = CASE
        WHEN EXCLUDED.status = 'succeeded' THEN NULL
        ELSE EXCLUDED.failure_code
      END,
      failure_message = CASE
        WHEN EXCLUDED.status = 'succeeded' THEN NULL
        ELSE EXCLUDED.failure_message
      END,
      charged_at = CASE
        WHEN EXCLUDED.status = 'succeeded' THEN COALESCE(public.recurring_charges.charged_at, NOW())
        ELSE public.recurring_charges.charged_at
      END,
      failed_at = CASE
        WHEN EXCLUDED.status = 'failed' THEN COALESCE(public.recurring_charges.failed_at, NOW())
        ELSE public.recurring_charges.failed_at
      END,
      resolved_at = CASE
        WHEN public.recurring_charges.status = 'failed' AND EXCLUDED.status = 'succeeded' THEN NOW()
        ELSE public.recurring_charges.resolved_at
      END
  RETURNING id INTO v_charge_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_debt
  FROM public.recurring_charges
  WHERE agreement_id = p_agreement_id AND status = 'failed';

  UPDATE public.recurring_agreements
  SET last_charge_number = GREATEST(last_charge_number, p_provider_charge_number)
  WHERE id = p_agreement_id;

  UPDATE public.club_memberships
  SET debt_amount = v_debt,
      payment_status = CASE
        WHEN status = 'cancelled' THEN 'cancelled'
        WHEN v_debt > 0 THEN 'past_due'
        ELSE 'current'
      END
  WHERE id = v_membership.id;

  RETURN jsonb_build_object(
    'duplicate', false,
    'agreement_id', p_agreement_id,
    'charge_id', v_charge_id,
    'debt_amount', v_debt,
    'kind', p_event_kind
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_icredit_enrollment_compensation(
  p_agreement_id UUID,
  p_provider_recurring_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agreement public.recurring_agreements%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  SELECT * INTO v_agreement
  FROM public.recurring_agreements
  WHERE id = p_agreement_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'agreement not found'; END IF;
  IF v_agreement.status <> 'cancelled' THEN RAISE EXCEPTION 'agreement is not cancelled'; END IF;
  IF v_agreement.provider_recurring_id IS DISTINCT FROM p_provider_recurring_id THEN
    RAISE EXCEPTION 'provider recurring id mismatch';
  END IF;
  IF v_agreement.compensation_required_at IS NULL THEN
    RAISE EXCEPTION 'compensation is not required';
  END IF;

  UPDATE public.recurring_agreements
  SET compensated_at = COALESCE(compensated_at, NOW())
  WHERE id = p_agreement_id;

  RETURN jsonb_build_object(
    'agreement_id', p_agreement_id,
    'compensated', true,
    'reused', v_agreement.compensated_at IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_icredit_recurring_membership(
  p_membership_id UUID,
  p_agreement_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agreement public.recurring_agreements%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  SELECT * INTO v_agreement
  FROM public.recurring_agreements
  WHERE id = p_agreement_id AND membership_id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'agreement not found'; END IF;
  IF v_agreement.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'membership_id', p_membership_id,
      'agreement_id', p_agreement_id,
      'cancelled', true,
      'reused', true
    );
  END IF;
  IF NOT (
    (v_agreement.status = 'pending_enrollment' AND v_agreement.provider_recurring_id IS NULL)
    OR v_agreement.status = 'provider_cancelled'
  ) THEN
    RAISE EXCEPTION 'provider cancellation confirmation required';
  END IF;

  UPDATE public.recurring_agreements
  SET status = 'cancelled',
      cancellation_requested_at = COALESCE(cancellation_requested_at, NOW()),
      cancelled_at = COALESCE(cancelled_at, NOW())
  WHERE id = p_agreement_id;

  UPDATE public.club_memberships
  SET status = 'cancelled', payment_status = 'cancelled',
      cancellation_requested_at = COALESCE(cancellation_requested_at, NOW()),
      cancelled_at = COALESCE(cancelled_at, NOW()),
      cancellation_effective_on = COALESCE(cancellation_effective_on, CURRENT_DATE),
      ends_on = COALESCE(ends_on, CURRENT_DATE)
  WHERE id = p_membership_id;

  RETURN jsonb_build_object('membership_id', p_membership_id, 'agreement_id', p_agreement_id, 'cancelled', true);
END;
$$;

REVOKE ALL ON FUNCTION public.process_icredit_recurring_event(UUID, TEXT, TEXT, UUID, UUID, INTEGER, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_icredit_recurring_event(UUID, TEXT, TEXT, UUID, UUID, INTEGER, NUMERIC, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.cancel_icredit_recurring_membership(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_icredit_recurring_membership(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.complete_icredit_enrollment_compensation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_icredit_enrollment_compensation(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.prepare_icredit_recurring_enrollment(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_icredit_recurring_enrollment(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.save_club_with_schedule(UUID, TEXT, TEXT, UUID, TEXT, INTEGER, NUMERIC, SMALLINT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_club_with_schedule(UUID, TEXT, TEXT, UUID, TEXT, INTEGER, NUMERIC, SMALLINT, TEXT, TEXT, JSONB) TO authenticated;
