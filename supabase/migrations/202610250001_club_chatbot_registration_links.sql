-- Month-specific admin-managed chatbot enrollment destinations. No payment provider is invoked.
CREATE TABLE public.bot_club_registration_links (
  registration_month date PRIMARY KEY,
  url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.profiles(id),
  CONSTRAINT registration_month_first_day CHECK (extract(day FROM registration_month) = 1),
  CONSTRAINT registration_https_url CHECK (
    url ~ '^https://[^[:space:]@/?#]+([/?][^[:space:]#]*)?$'
    AND length(url) <= 2048
  )
);

ALTER TABLE public.bot_club_registration_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_club_registration_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bot_club_registration_links TO authenticated;
GRANT SELECT ON public.bot_club_registration_links TO service_role;

CREATE POLICY club_chatbot_registration_admin_read
  ON public.bot_club_registration_links FOR SELECT TO authenticated
  USING (coalesce(public.is_admin(), false));
CREATE POLICY club_chatbot_registration_admin_insert
  ON public.bot_club_registration_links FOR INSERT TO authenticated
  WITH CHECK (coalesce(public.is_admin(), false) AND updated_by = auth.uid());
CREATE POLICY club_chatbot_registration_admin_update
  ON public.bot_club_registration_links FOR UPDATE TO authenticated
  USING (coalesce(public.is_admin(), false))
  WITH CHECK (coalesce(public.is_admin(), false) AND updated_by = auth.uid());
