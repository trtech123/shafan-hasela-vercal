-- Accountant-supplied reference data. These rows are evidence, not posting approval.
-- No Rivhit capture, posting or historical financial row is changed.
BEGIN;

CREATE TABLE public.rivhit_accountant_account_groups (
  sort_code integer PRIMARY KEY,
  group_name text NOT NULL UNIQUE,
  revenue_account integer NOT NULL,
  cash_account integer NOT NULL,
  cheque_account integer NOT NULL,
  card_account integer NOT NULL,
  vat_rate_basis_points integer NOT NULL CHECK (vat_rate_basis_points BETWEEN 0 AND 10000),
  source_worksheet text NOT NULL DEFAULT 'קודי מיון.xlsx',
  source_row integer NOT NULL CHECK (source_row > 0)
);
-- The accountant's real account numbers are held in a separate, ignored
-- local seed file. This public source repository must not publish them.
ALTER TABLE public.rivhit_accountant_account_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rivhit_accountant_account_groups FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.rivhit_accountant_account_groups TO authenticated,service_role;
CREATE POLICY accountant_groups_admin_read ON public.rivhit_accountant_account_groups
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role::text='admin'));

-- These four relationships are explicit in the saved business taxonomy:
-- acre_extreme_park -> עכו, berko_360_tiberias -> טבריה,
-- nof_hagalil_zipline -> נוף הגליל, and the exact cafe site name.
-- פודטראק may include locations outside Barko; שטח is broader than Via Ferrata.
CREATE TABLE public.rivhit_accounting_site_groups (
  site text PRIMARY KEY CHECK (site IN
    ('עכו','טבריה','נוף הגליל','שטח','פודטראק','קפה אקסטרים')),
  accountant_sort_code integer NOT NULL,
  evidence text NOT NULL,
  approved boolean NOT NULL DEFAULT false
);
INSERT INTO public.rivhit_accounting_site_groups
  (site,accountant_sort_code,evidence,approved) VALUES
  ('עכו',102,'chatbot:acre_extreme_park',true),
  ('טבריה',103,'chatbot:berko_360_tiberias',true),
  ('נוף הגליל',118,'chatbot:nof_hagalil_zipline',true),
  ('קפה אקסטרים',117,'exact_site_name',true),
  ('פודטראק',107,'management_location_confirmation_required',false),
  ('שטח',116,'management_activity_scope_confirmation_required',false);
ALTER TABLE public.rivhit_accounting_site_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rivhit_accounting_site_groups FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.rivhit_accounting_site_groups TO authenticated,service_role;
CREATE POLICY accountant_site_groups_admin_read ON public.rivhit_accounting_site_groups
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role::text='admin'));

-- Posting rows are seeded separately with accountant account numbers after
-- site and account approval; the public migration never carries those numbers.
ALTER TABLE public.rivhit_journal_approved_mappings
  DROP CONSTRAINT rivhit_journal_approved_mappings_site_check,
  ADD CONSTRAINT rivhit_journal_approved_mappings_site_check CHECK (site IN
    ('עכו','טבריה','נוף הגליל','שטח','פודטראק','קפה אקסטרים'));
ALTER TABLE public.rivhit_journal_approved_mappings
  ADD COLUMN accountant_sort_code integer
  REFERENCES public.rivhit_accountant_account_groups(sort_code);
ALTER TABLE public.rivhit_journal_approved_mappings
  ADD CONSTRAINT rivhit_accountant_group_required CHECK (
    NOT enabled OR accountant_sort_code IS NOT NULL);

-- Approval rows must use exactly the supplied debit and revenue accounts.
CREATE FUNCTION public.enforce_rivhit_accountant_group() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.rivhit_accountant_account_groups%ROWTYPE;
  site_group public.rivhit_accounting_site_groups%ROWTYPE;
BEGIN
  IF NOT NEW.enabled THEN RETURN NEW; END IF;
  SELECT * INTO site_group FROM public.rivhit_accounting_site_groups
    WHERE site=NEW.site AND approved;
  IF NOT FOUND OR site_group.accountant_sort_code IS DISTINCT FROM NEW.accountant_sort_code
    THEN RAISE EXCEPTION 'rivhit_accounting_site_unapproved' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM public.rivhit_accountant_account_groups
    WHERE sort_code=NEW.accountant_sort_code;
  IF NOT FOUND OR NEW.sort_code IS DISTINCT FROM a.sort_code
    OR NEW.credit_account IS DISTINCT FROM a.revenue_account
    OR NEW.vat_rate_basis_points IS DISTINCT FROM a.vat_rate_basis_points
    OR (NEW.provider='manual_cash' AND NEW.debit_account IS DISTINCT FROM a.cash_account)
    OR (NEW.provider='manual_check' AND NEW.debit_account IS DISTINCT FROM a.cheque_account)
    OR (NEW.provider='pelecard' AND NEW.debit_account IS DISTINCT FROM a.card_account)
  THEN RAISE EXCEPTION 'rivhit_accountant_mapping_mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_enforce_rivhit_accountant_group BEFORE INSERT OR UPDATE
  ON public.rivhit_journal_approved_mappings FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rivhit_accountant_group();
REVOKE ALL ON FUNCTION public.enforce_rivhit_accountant_group()
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
