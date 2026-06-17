-- ============================================================
-- Migration 015: Add two new business sites
--
-- New sites: 'פודטראק', 'קפה אקסטרים'.
-- They must behave exactly like existing sites, so the site CHECK
-- constraints on every site-bearing table are widened to include them.
--
-- Tables with a CHECK on site:
--   orders.site             (nullable)
--   quotes.site             (nullable)
--   leads.site              (nullable; also keeps legacy 'ויה פרטה')
--   maintenance_tasks.site  (NOT NULL)
-- blocked_slots.site is free TEXT (no CHECK) on purpose — untouched.
-- activities / sales have no site column — untouched.
-- ============================================================

-- ORDERS ------------------------------------------------------
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_site_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_site_check CHECK (
    site IS NULL
    OR site IN ('עכו', 'טבריה', 'נוף הגליל', 'שטח', 'פודטראק', 'קפה אקסטרים')
  );

-- QUOTES ------------------------------------------------------
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_site_check;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_site_check CHECK (
    site IS NULL
    OR site IN ('עכו', 'טבריה', 'נוף הגליל', 'שטח', 'פודטראק', 'קפה אקסטרים')
  );

-- LEADS (keeps legacy 'ויה פרטה' from migration 011) ----------
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_site_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_site_check CHECK (
    site IS NULL
    OR site IN ('עכו', 'טבריה', 'נוף הגליל', 'שטח', 'ויה פרטה', 'פודטראק', 'קפה אקסטרים')
  );

-- MAINTENANCE TASKS (site is NOT NULL) ------------------------
ALTER TABLE public.maintenance_tasks DROP CONSTRAINT IF EXISTS maintenance_tasks_site_check;
ALTER TABLE public.maintenance_tasks
  ADD CONSTRAINT maintenance_tasks_site_check CHECK (
    site IN ('עכו', 'טבריה', 'נוף הגליל', 'שטח', 'פודטראק', 'קפה אקסטרים')
  );
