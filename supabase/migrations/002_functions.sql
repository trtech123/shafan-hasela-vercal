-- ============================================================
-- Migration 002: Auth Helper Functions & Triggers
-- ============================================================

-- ============================================================
-- ROLE HELPERS
-- All SECURITY DEFINER + STABLE so Postgres can inline/cache.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_admin_or_ops()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'operations')
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns the instructors.id for the currently logged-in user,
-- matched by email. Used in order RLS policies.
CREATE OR REPLACE FUNCTION public.get_my_instructor_id()
RETURNS UUID AS $$
  SELECT i.id
  FROM public.instructors i
  JOIN public.profiles p ON p.email = i.email
  WHERE p.id = auth.uid()
  LIMIT 1
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- Fires after Supabase creates a row in auth.users.
-- Default role is 'instructor'; admin must promote via dashboard.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'instructor'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- AUTO-COMPUTE total_price ON ORDERS
-- Keeps total_price = num_participants * price_per_person
-- unless manually overridden (set price_per_person to NULL to skip).
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_order_total()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.price_per_person IS NOT NULL AND NEW.num_participants IS NOT NULL THEN
    NEW.total_price = NEW.price_per_person * NEW.num_participants;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_compute_total
  BEFORE INSERT OR UPDATE OF price_per_person, num_participants
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.compute_order_total();

-- ============================================================
-- AUTO-COMPUTE final_price ON QUOTES
-- final_price = total_price - discount
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_quote_final_price()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.total_price IS NOT NULL THEN
    NEW.final_price = COALESCE(NEW.total_price, 0) - COALESCE(NEW.discount, 0);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_quotes_compute_final_price
  BEFORE INSERT OR UPDATE OF total_price, discount
  ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.compute_quote_final_price();

-- ============================================================
-- COMPUTED VIEW: dashboard_stats
-- Powers the Dashboard page without per-table queries.
-- ============================================================

CREATE OR REPLACE VIEW public.dashboard_stats AS
SELECT
  (SELECT COUNT(*) FROM public.orders WHERE status NOT IN ('בוטל'))                         AS active_orders,
  (SELECT COUNT(*) FROM public.orders WHERE activity_date = CURRENT_DATE)                   AS orders_today,
  (SELECT COUNT(*) FROM public.leads WHERE status = 'פתוח')                                 AS open_leads,
  (SELECT COUNT(*) FROM public.quotes WHERE status IN ('טיוטה', 'נשלחה', 'ממתינה לאישור')) AS pending_quotes,
  (SELECT COALESCE(SUM(total_price), 0) FROM public.orders
    WHERE status = 'שולם'
    AND date_trunc('month', activity_date) = date_trunc('month', CURRENT_DATE))             AS revenue_this_month,
  (SELECT COUNT(*) FROM public.tasks WHERE status IN ('פתוחה', 'בביצוע')
    AND due_date <= CURRENT_DATE + INTERVAL '7 days')                                        AS tasks_due_soon;

-- ============================================================
-- COMPUTED VIEW: instructor_schedule
-- Used by the Schedule page — orders per instructor per date.
-- ============================================================

CREATE OR REPLACE VIEW public.instructor_schedule AS
SELECT
  o.id            AS order_id,
  o.order_number,
  o.activity_date,
  o.start_time,
  o.end_time,
  o.site,
  o.num_participants,
  o.status,
  o.client_name,
  o.organization,
  o.instructor_notified,
  a.name          AS activity_name,
  a.duration_hours,
  i.id            AS instructor_id,
  i.full_name     AS instructor_name,
  i.phone         AS instructor_phone,
  i.email         AS instructor_email
FROM public.orders o
LEFT JOIN public.activities a ON a.id = o.activity_id
LEFT JOIN public.instructors i ON i.id = o.instructor_id
WHERE o.status != 'בוטל';

-- ============================================================
-- COMPUTED VIEW: sales_summary
-- Powers DailySalesReport page.
-- ============================================================

CREATE OR REPLACE VIEW public.sales_summary AS
SELECT
  sale_date,
  COUNT(*)                    AS receipt_count,
  SUM(total)                  AS daily_total,
  jsonb_agg(
    jsonb_build_object(
      'receipt_number', receipt_number,
      'total', total,
      'method', method,
      'items', items
    ) ORDER BY created_at
  )                           AS receipts
FROM public.sales
GROUP BY sale_date
ORDER BY sale_date DESC;
