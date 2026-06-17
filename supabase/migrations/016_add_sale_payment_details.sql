-- ============================================================
-- Migration 016: Manual payment details on sales (check support)
--
-- sales.method is already free TEXT (no CHECK), so new payment methods
-- like 'צ'ק' need no enum change. What's missing is a place to store the
-- structured details a manual check requires (check number, bank, branch,
-- account, holder, due date, amount, notes).
--
-- Add a nullable JSONB column. NULL = no extra details (cash/credit/etc.).
-- For a check the shape is:
--   { "check_number", "bank", "branch", "account_number",
--     "account_holder", "due_date", "amount", "notes" }
--
-- Forward-compatible with split payments (Task 4) — that feature can store
-- an array of method/amount entries in the same column without a new migration.
-- ============================================================

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_details JSONB;

COMMENT ON COLUMN public.sales.payment_details IS
  'Structured manual-payment details (e.g. check: number/bank/branch/account/holder/due_date/amount/notes). NULL for plain cash/credit.';
