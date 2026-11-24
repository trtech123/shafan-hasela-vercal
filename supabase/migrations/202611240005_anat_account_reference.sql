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

-- A site-to-group relationship requires explicit management review. No rows
-- are inserted here: Acre, Tiberias and Field cannot be inferred from names.
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
BEGIN
  IF NOT NEW.enabled THEN RETURN NEW; END IF;
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
