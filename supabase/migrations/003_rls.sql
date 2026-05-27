-- ============================================================
-- Migration 003: Row Level Security Policies
--
-- Roles:
--   admin       — full access to everything
--   operations  — (אחמ"ש) full CRUD on business data, no user mgmt
--   instructor  — (מדריך) read own orders/tasks, no financial data
-- ============================================================

-- Enable RLS on every table
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructors      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_sheets   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROFILES
-- ============================================================

-- Own profile — always readable
CREATE POLICY "profiles: read own"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

-- Admin reads all profiles (for user management)
CREATE POLICY "profiles: admin read all"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

-- Own profile — update (name, email)
CREATE POLICY "profiles: update own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Admin updates any profile (role assignment)
CREATE POLICY "profiles: admin update all"
  ON public.profiles FOR UPDATE
  USING (public.is_admin());

-- Only Supabase trigger creates profiles (no direct INSERT)
-- No INSERT policy — handle_new_user() uses SECURITY DEFINER

-- Admin can delete profiles (account removal)
CREATE POLICY "profiles: admin delete"
  ON public.profiles FOR DELETE
  USING (public.is_admin());

-- ============================================================
-- ACTIVITIES
-- All staff can see activities. Only admin/ops can modify.
-- ============================================================

CREATE POLICY "activities: all staff read"
  ON public.activities FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "activities: admin/ops insert"
  ON public.activities FOR INSERT
  WITH CHECK (public.is_admin_or_ops());

CREATE POLICY "activities: admin/ops update"
  ON public.activities FOR UPDATE
  USING (public.is_admin_or_ops());

CREATE POLICY "activities: admin delete"
  ON public.activities FOR DELETE
  USING (public.is_admin());

-- ============================================================
-- INSTRUCTORS
-- All staff can see instructor list. Only admin/ops can modify.
-- ============================================================

CREATE POLICY "instructors: all staff read"
  ON public.instructors FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "instructors: admin/ops insert"
  ON public.instructors FOR INSERT
  WITH CHECK (public.is_admin_or_ops());

CREATE POLICY "instructors: admin/ops update"
  ON public.instructors FOR UPDATE
  USING (public.is_admin_or_ops());

CREATE POLICY "instructors: admin delete"
  ON public.instructors FOR DELETE
  USING (public.is_admin());

-- ============================================================
-- ORDERS
-- Admin/ops: full access.
-- Instructor: read orders assigned to them only.
-- ============================================================

CREATE POLICY "orders: admin/ops read"
  ON public.orders FOR SELECT
  USING (public.is_admin_or_ops());

-- Instructor sees only their own scheduled orders
CREATE POLICY "orders: instructor read own"
  ON public.orders FOR SELECT
  USING (
    instructor_id = public.get_my_instructor_id()
  );

CREATE POLICY "orders: admin/ops insert"
  ON public.orders FOR INSERT
  WITH CHECK (public.is_admin_or_ops());

CREATE POLICY "orders: admin/ops update"
  ON public.orders FOR UPDATE
  USING (public.is_admin_or_ops());

-- Instructors can mark themselves as notified
CREATE POLICY "orders: instructor update notified"
  ON public.orders FOR UPDATE
  USING (
    instructor_id = public.get_my_instructor_id()
  )
  WITH CHECK (
    instructor_id = public.get_my_instructor_id()
  );

CREATE POLICY "orders: admin delete"
  ON public.orders FOR DELETE
  USING (public.is_admin());

-- ============================================================
-- QUOTES
-- Admin/ops: full access.
-- Instructor: read quotes that became their order (lineage only).
-- ============================================================

CREATE POLICY "quotes: admin/ops read"
  ON public.quotes FOR SELECT
  USING (public.is_admin_or_ops());

CREATE POLICY "quotes: instructor read linked"
  ON public.quotes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.quote_id = id
        AND o.instructor_id = public.get_my_instructor_id()
    )
  );

CREATE POLICY "quotes: admin/ops insert"
  ON public.quotes FOR INSERT
  WITH CHECK (public.is_admin_or_ops());

CREATE POLICY "quotes: admin/ops update"
  ON public.quotes FOR UPDATE
  USING (public.is_admin_or_ops());

CREATE POLICY "quotes: admin delete"
  ON public.quotes FOR DELETE
  USING (public.is_admin());

-- ============================================================
-- LEADS
-- Admin/ops only. Instructors have no visibility into pipeline.
-- ============================================================

CREATE POLICY "leads: admin/ops read"
  ON public.leads FOR SELECT
  USING (public.is_admin_or_ops());

CREATE POLICY "leads: admin/ops insert"
  ON public.leads FOR INSERT
  WITH CHECK (public.is_admin_or_ops());

CREATE POLICY "leads: admin/ops update"
  ON public.leads FOR UPDATE
  USING (public.is_admin_or_ops());

CREATE POLICY "leads: admin delete"
  ON public.leads FOR DELETE
  USING (public.is_admin());

-- ============================================================
-- TASKS
-- Admin/ops: full access.
-- Instructor: read + update status of tasks assigned to them.
-- ============================================================

CREATE POLICY "tasks: admin/ops read"
  ON public.tasks FOR SELECT
  USING (public.is_admin_or_ops());

CREATE POLICY "tasks: instructor read assigned"
  ON public.tasks FOR SELECT
  USING (assigned_to = auth.uid());

CREATE POLICY "tasks: admin/ops insert"
  ON public.tasks FOR INSERT
  WITH CHECK (public.is_admin_or_ops());

CREATE POLICY "tasks: admin/ops update"
  ON public.tasks FOR UPDATE
  USING (public.is_admin_or_ops());

-- Instructors can update status/notes on tasks assigned to them
CREATE POLICY "tasks: instructor update own"
  ON public.tasks FOR UPDATE
  USING (assigned_to = auth.uid())
  WITH CHECK (assigned_to = auth.uid());

CREATE POLICY "tasks: admin/ops delete"
  ON public.tasks FOR DELETE
  USING (public.is_admin_or_ops());

-- ============================================================
-- MAINTENANCE TASKS
-- Admin/ops: full access.
-- Instructor: read + update tasks assigned to them.
-- ============================================================

CREATE POLICY "maintenance: admin/ops read"
  ON public.maintenance_tasks FOR SELECT
  USING (public.is_admin_or_ops());

CREATE POLICY "maintenance: instructor read assigned"
  ON public.maintenance_tasks FOR SELECT
  USING (assigned_to = auth.uid());

CREATE POLICY "maintenance: admin/ops insert"
  ON public.maintenance_tasks FOR INSERT
  WITH CHECK (public.is_admin_or_ops());

CREATE POLICY "maintenance: admin/ops update"
  ON public.maintenance_tasks FOR UPDATE
  USING (public.is_admin_or_ops());

CREATE POLICY "maintenance: instructor update own"
  ON public.maintenance_tasks FOR UPDATE
  USING (assigned_to = auth.uid())
  WITH CHECK (assigned_to = auth.uid());

CREATE POLICY "maintenance: admin delete"
  ON public.maintenance_tasks FOR DELETE
  USING (public.is_admin());

-- ============================================================
-- SALES (Cash Register)
-- Admin/ops only. Receipts are immutable — no UPDATE policy.
-- ============================================================

CREATE POLICY "sales: admin/ops read"
  ON public.sales FOR SELECT
  USING (public.is_admin_or_ops());

CREATE POLICY "sales: admin/ops insert"
  ON public.sales FOR INSERT
  WITH CHECK (public.is_admin_or_ops());

-- No UPDATE policy — receipts must not be modified after creation.
-- Corrections: issue a new negative-total receipt.

CREATE POLICY "sales: admin delete"
  ON public.sales FOR DELETE
  USING (public.is_admin());

-- ============================================================
-- PRICING SHEETS
-- Admin/ops only. Financial data not exposed to instructors.
-- ============================================================

CREATE POLICY "pricing: admin/ops read"
  ON public.pricing_sheets FOR SELECT
  USING (public.is_admin_or_ops());

CREATE POLICY "pricing: admin/ops insert"
  ON public.pricing_sheets FOR INSERT
  WITH CHECK (public.is_admin_or_ops());

CREATE POLICY "pricing: admin/ops update"
  ON public.pricing_sheets FOR UPDATE
  USING (public.is_admin_or_ops());

CREATE POLICY "pricing: admin delete"
  ON public.pricing_sheets FOR DELETE
  USING (public.is_admin());
