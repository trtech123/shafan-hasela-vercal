-- ============================================================
-- Migration 013: RLS grants for the cashier (קופאי) role
--
-- Cashier may: VIEW / CREATE / EDIT orders, and VIEW / CREATE sales (receipts).
-- Cashier already inherits (from migration 003, unchanged here):
--   - activities  SELECT  (auth.uid() IS NOT NULL)  → order/schedule display
--   - instructors SELECT  (auth.uid() IS NOT NULL)  → instructor names
--   - profiles    SELECT own row                    → login / role resolution
--
-- Cashier is deliberately NOT granted: leads, quotes, pricing, maintenance,
-- tasks, activity/instructor management, profile admin, order/sale DELETE.
-- (On the Schedule page the task/maintenance lanes simply render empty for a
-- cashier — RLS filters them out silently, no error.)
--
-- These policies are ADDITIVE — permissive policies are OR'd, so the existing
-- admin/ops/instructor policies from 003 are untouched.
--
-- Requires migration 012 (the 'cashier' enum value) applied first.
-- ============================================================

-- Helper: is the current user a cashier?
CREATE OR REPLACE FUNCTION public.is_cashier()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'cashier'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---- ORDERS: cashier view / create / edit ----
CREATE POLICY "orders: cashier read"
  ON public.orders FOR SELECT
  USING (public.is_cashier());

CREATE POLICY "orders: cashier insert"
  ON public.orders FOR INSERT
  WITH CHECK (public.is_cashier());

CREATE POLICY "orders: cashier update"
  ON public.orders FOR UPDATE
  USING (public.is_cashier())
  WITH CHECK (public.is_cashier());

-- (No cashier DELETE policy — deleting orders stays admin-only.)

-- ---- SALES (cash register): cashier view / create ----
CREATE POLICY "sales: cashier read"
  ON public.sales FOR SELECT
  USING (public.is_cashier());

CREATE POLICY "sales: cashier insert"
  ON public.sales FOR INSERT
  WITH CHECK (public.is_cashier());

-- (No cashier UPDATE — receipts immutable. No cashier DELETE — admin-only.)
