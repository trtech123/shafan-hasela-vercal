-- ============================================================
-- Migration 019: Product management module
--
-- Standalone products (distinct from activities), used mainly for the
-- פודטראק / קפה אקסטרים sites and prepared for future POS usage.
--
-- RLS:
--   read   — any authenticated staff (POS-prep; cashier included)
--   write  — admin only (create / edit / delete / deactivate)
-- Images reuse the existing public 'activity-images' bucket (004_storage.sql);
-- no new bucket / storage migration.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.products (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  price       NUMERIC(10,2),
  image_url   TEXT,
  site        TEXT CHECK (
    site IS NULL
    OR site IN ('טבריה', 'עכו', 'שטח', 'ויה פרטה', 'פודטראק', 'קפה אקסטרים')
  ),
  status      TEXT NOT NULL DEFAULT 'פעיל' CHECK (status IN ('פעיל', 'לא פעיל')),
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_site ON public.products(site);

-- Idempotent: drop-then-create so re-running the migration is safe.
DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS ---------------------------------------------------------
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products: all staff read" ON public.products;
CREATE POLICY "products: all staff read"
  ON public.products FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "products: admin insert" ON public.products;
CREATE POLICY "products: admin insert"
  ON public.products FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "products: admin update" ON public.products;
CREATE POLICY "products: admin update"
  ON public.products FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "products: admin delete" ON public.products;
CREATE POLICY "products: admin delete"
  ON public.products FOR DELETE
  USING (public.is_admin());
