-- Clubs operational rules. iCredit remains the sole financial authority.
-- No accounting-document synchronization or partial-month automation.

ALTER TABLE public.clubs ALTER COLUMN default_billing_day SET DEFAULT 15;
UPDATE public.clubs SET default_billing_day = 15 WHERE default_billing_day <> 15;
ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS clubs_default_billing_day_check;
ALTER TABLE public.clubs ADD CONSTRAINT clubs_default_billing_day_check CHECK (default_billing_day = 15);

ALTER TABLE public.club_participants
  ADD COLUMN payer_name TEXT,
  ADD COLUMN payer_relationship TEXT,
  ADD COLUMN payer_phone TEXT,
  ADD COLUMN payer_email TEXT;
UPDATE public.club_participants SET
  payer_name = COALESCE(payer_name, primary_contact_name),
  payer_relationship = COALESCE(payer_relationship, primary_contact_relationship),
  payer_phone = COALESCE(payer_phone, primary_contact_phone),
  payer_email = COALESCE(payer_email, primary_contact_email);

ALTER TABLE public.club_memberships
  ADD COLUMN recurring_starts_on DATE,
  ADD COLUMN current_month_settlement_status TEXT NOT NULL DEFAULT 'manual_required'
    CHECK (current_month_settlement_status IN ('manual_required', 'settled', 'not_required'));
UPDATE public.club_memberships SET
  billing_day = 15,
  recurring_starts_on = COALESCE(recurring_starts_on, date_trunc('month', starts_on)::DATE + INTERVAL '1 month');
ALTER TABLE public.club_memberships ALTER COLUMN recurring_starts_on SET NOT NULL;
ALTER TABLE public.club_memberships DROP CONSTRAINT IF EXISTS club_memberships_billing_day_check;
ALTER TABLE public.club_memberships ADD CONSTRAINT club_memberships_billing_day_check CHECK (billing_day = 15);
ALTER TABLE public.club_memberships DROP CONSTRAINT IF EXISTS club_memberships_status_check;
ALTER TABLE public.club_memberships ADD CONSTRAINT club_memberships_status_check
  CHECK (status IN ('pending_enrollment', 'active', 'paused', 'cancellation_scheduled', 'cancelled', 'ended'));

CREATE OR REPLACE FUNCTION public.preserve_scheduled_club_cancellation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'cancellation_scheduled' AND NEW.status = 'active' THEN
    NEW.status := 'cancellation_scheduled';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_preserve_scheduled_club_cancellation BEFORE UPDATE OF status ON public.club_memberships
FOR EACH ROW EXECUTE FUNCTION public.preserve_scheduled_club_cancellation();

UPDATE public.recurring_agreements ra SET recurring_day = 15,
  starts_on = cm.recurring_starts_on
FROM public.club_memberships cm WHERE cm.id = ra.membership_id;
ALTER TABLE public.recurring_agreements DROP CONSTRAINT IF EXISTS recurring_agreements_recurring_day_check;
ALTER TABLE public.recurring_agreements ADD CONSTRAINT recurring_agreements_recurring_day_check CHECK (recurring_day = 15);

CREATE OR REPLACE FUNCTION public.enforce_club_recurring_schedule()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  SELECT 15, recurring_starts_on INTO NEW.recurring_day, NEW.starts_on
  FROM public.club_memberships WHERE id = NEW.membership_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_enforce_club_recurring_schedule BEFORE INSERT OR UPDATE OF membership_id, recurring_day, starts_on
ON public.recurring_agreements FOR EACH ROW EXECUTE FUNCTION public.enforce_club_recurring_schedule();

ALTER TABLE public.recurring_charges
  ADD COLUMN billing_month DATE,
  ADD COLUMN provider_authoritative BOOLEAN NOT NULL DEFAULT TRUE CHECK (provider_authoritative = TRUE);
UPDATE public.recurring_charges SET billing_month = date_trunc('month', COALESCE(charged_at, failed_at, created_at) AT TIME ZONE 'Asia/Jerusalem')::DATE;
ALTER TABLE public.recurring_charges ALTER COLUMN billing_month SET NOT NULL;

CREATE OR REPLACE FUNCTION public.set_club_charge_billing_month()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.billing_month := date_trunc('month', COALESCE(NEW.charged_at, NEW.failed_at, NOW()) AT TIME ZONE 'Asia/Jerusalem')::DATE;
  NEW.provider_authoritative := TRUE;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_set_club_charge_billing_month BEFORE INSERT OR UPDATE ON public.recurring_charges
FOR EACH ROW EXECUTE FUNCTION public.set_club_charge_billing_month();

CREATE TABLE public.club_payment_follow_ups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recurring_charge_id UUID NOT NULL REFERENCES public.recurring_charges(id) ON DELETE RESTRICT,
  membership_id UUID NOT NULL REFERENCES public.club_memberships(id) ON DELETE RESTRICT,
  payer_name TEXT,
  payer_phone TEXT,
  payer_email TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'resolved')),
  delivery_status TEXT NOT NULL DEFAULT 'not_sent' CHECK (delivery_status IN ('not_sent', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recurring_charge_id)
);
ALTER TABLE public.club_payment_follow_ups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "club payment follow ups: admin read" ON public.club_payment_follow_ups FOR SELECT USING (public.is_admin());
CREATE POLICY "club payment follow ups: admin update" ON public.club_payment_follow_ups FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, UPDATE ON public.club_payment_follow_ups TO authenticated;
CREATE TRIGGER trg_club_payment_follow_ups_updated_at BEFORE UPDATE ON public.club_payment_follow_ups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.club_cancellation_effective_on(p_requested_on DATE)
RETURNS DATE LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (date_trunc('month', p_requested_on)::DATE
    + CASE WHEN EXTRACT(DAY FROM p_requested_on) <= 10 THEN INTERVAL '1 month' ELSE INTERVAL '2 months' END)::DATE;
$$;

CREATE OR REPLACE FUNCTION public.request_club_membership_cancellation(p_membership_id UUID, p_requested_on DATE DEFAULT CURRENT_DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_effective DATE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin required'; END IF;
  v_effective := public.club_cancellation_effective_on(p_requested_on);
  UPDATE public.club_memberships SET status = 'cancellation_scheduled',
    cancellation_requested_at = p_requested_on::TIMESTAMPTZ,
    cancellation_effective_on = v_effective
  WHERE id = p_membership_id AND status IN ('pending_enrollment', 'active', 'paused', 'cancellation_scheduled');
  IF NOT FOUND THEN RAISE EXCEPTION 'membership cannot be cancelled'; END IF;
  RETURN jsonb_build_object('membership_id', p_membership_id, 'requested_on', p_requested_on, 'effective_on', v_effective);
END; $$;
REVOKE ALL ON FUNCTION public.request_club_membership_cancellation(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_club_membership_cancellation(UUID, DATE) TO authenticated;

CREATE OR REPLACE VIEW public.club_attendance_operations WITH (security_invoker = true) AS
SELECT s.id AS session_id, s.club_id, s.session_date, s.start_time, s.end_time,
  m.id AS membership_id, p.id AS participant_id,
  trim(p.first_name || ' ' || p.last_name) AS participant_name,
  p.payer_name, p.payer_phone, p.payer_email,
  a.id AS attendance_id, a.status AS attendance_status,
  CASE WHEN c.status = 'succeeded' THEN 'settled'
       WHEN c.status = 'failed' THEN 'failed' ELSE 'unknown' END AS payment_state,
  c.status AS provider_charge_status, c.id AS recurring_charge_id
FROM public.club_sessions s
JOIN public.club_memberships m ON m.club_id = s.club_id
  AND m.starts_on <= s.session_date
  AND (m.ends_on IS NULL OR m.ends_on >= s.session_date)
  AND m.status NOT IN ('cancelled', 'ended')
JOIN public.club_participants p ON p.id = m.participant_id
LEFT JOIN public.club_attendance a ON a.session_id = s.id AND a.membership_id = m.id
LEFT JOIN public.recurring_agreements ra ON ra.membership_id = m.id AND ra.provider = 'icredit'
LEFT JOIN LATERAL (
  SELECT rc.id, rc.status FROM public.recurring_charges rc
  WHERE rc.agreement_id = ra.id
    AND rc.billing_month = date_trunc('month', s.session_date)::DATE
    AND rc.provider_authoritative = TRUE
  ORDER BY CASE rc.status WHEN 'succeeded' THEN 0 ELSE 1 END, rc.updated_at DESC LIMIT 1
) c ON TRUE;
GRANT SELECT ON public.club_attendance_operations TO authenticated;

CREATE OR REPLACE FUNCTION public.create_failed_club_payment_follow_up()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_membership UUID; v_payer public.club_participants%ROWTYPE;
BEGIN
  IF NEW.status = 'succeeded' THEN
    UPDATE public.club_payment_follow_ups SET status = 'resolved', updated_at = NOW()
    WHERE recurring_charge_id = NEW.id AND status <> 'resolved';
    RETURN NEW;
  END IF;
  IF NEW.status <> 'failed' THEN RETURN NEW; END IF;
  SELECT cm.id INTO v_membership FROM public.recurring_agreements ra
  JOIN public.club_memberships cm ON cm.id = ra.membership_id WHERE ra.id = NEW.agreement_id;
  SELECT cp.* INTO v_payer FROM public.club_memberships cm
  JOIN public.club_participants cp ON cp.id = cm.participant_id WHERE cm.id = v_membership;
  INSERT INTO public.club_payment_follow_ups(recurring_charge_id, membership_id, payer_name, payer_phone, payer_email, message)
  VALUES (NEW.id, v_membership, v_payer.payer_name, v_payer.payer_phone, v_payer.payer_email,
    'שלום' || CASE WHEN v_payer.payer_name IS NULL THEN '' ELSE ' ' || v_payer.payer_name END ||
    ', התשלום נכשל. יש לפנות למשרד כדי לעדכן או להסדיר את כרטיס האשראי הרלוונטי.')
  ON CONFLICT (recurring_charge_id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_failed_club_payment_follow_up AFTER INSERT OR UPDATE OF status ON public.recurring_charges
FOR EACH ROW EXECUTE FUNCTION public.create_failed_club_payment_follow_up();
REVOKE ALL ON FUNCTION public.create_failed_club_payment_follow_up() FROM PUBLIC, anon, authenticated;

INSERT INTO public.club_payment_follow_ups(recurring_charge_id, membership_id, payer_name, payer_phone, payer_email, message)
SELECT rc.id, cm.id, cp.payer_name, cp.payer_phone, cp.payer_email,
  'שלום' || CASE WHEN cp.payer_name IS NULL THEN '' ELSE ' ' || cp.payer_name END ||
  ', התשלום נכשל. יש לפנות למשרד כדי לעדכן או להסדיר את כרטיס האשראי הרלוונטי.'
FROM public.recurring_charges rc
JOIN public.recurring_agreements ra ON ra.id = rc.agreement_id
JOIN public.club_memberships cm ON cm.id = ra.membership_id
JOIN public.club_participants cp ON cp.id = cm.participant_id
WHERE rc.status = 'failed'
ON CONFLICT (recurring_charge_id) DO NOTHING;
