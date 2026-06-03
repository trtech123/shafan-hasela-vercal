-- ============================================================
-- Migration 009: Availability blocking (blocked_slots)
--
-- Adds a single new table to record manual full-day or hour-range
-- blocks against site availability, plus blocks auto-created from
-- an existing order ("lock this slot") so additional orders aren't
-- placed on top of a confirmed booking.
--
-- Purely additive. No changes to existing tables. No data migration.
-- ============================================================

-- ============================================================
-- TABLE: blocked_slots
-- ============================================================

CREATE TABLE public.blocked_slots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Free TEXT (no CHECK enum) on purpose: existing site enums drift
  -- between orders/quotes/maintenance ('עכו','טבריה','נוף הגליל','שטח')
  -- and leads ('עכו','טבריה','שטח','ויה פרטה'). Keeping this column
  -- decoupled lets the UI evolve without a schema patch each time.
  -- NULL = applies to all sites (e.g. company-wide closure).
  site            TEXT,

  block_date      DATE NOT NULL,
  start_time      TIME,                          -- both NULL = all-day
  end_time        TIME,

  reason          TEXT NOT NULL,

  source          TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'order_lock')),

  -- When source='order_lock', references the order whose slot is locked.
  -- ON DELETE CASCADE so deleting the order clears the auto-block.
  source_order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,

  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- All-day rows have both times NULL; hour-range rows have both set
  -- and start strictly before end.
  CONSTRAINT blocked_slots_time_range_check CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

-- Calendar fetch is range-by-date — primary lookup path.
CREATE INDEX idx_blocked_slots_date
  ON public.blocked_slots (block_date);

-- Per-site lookups (siteFilter='טבריה' etc.) hit this composite index.
CREATE INDEX idx_blocked_slots_site_date
  ON public.blocked_slots (site, block_date);

CREATE TRIGGER trg_blocked_slots_updated_at
  BEFORE UPDATE ON public.blocked_slots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- All authenticated staff (incl. instructors) can read blocks so
-- they understand why a date is unavailable on Schedule. Only
-- admin + operations can create/update/delete blocks.
-- ============================================================

ALTER TABLE public.blocked_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blocked_slots: all staff read"
  ON public.blocked_slots FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "blocked_slots: admin/ops insert"
  ON public.blocked_slots FOR INSERT
  WITH CHECK (public.is_admin_or_ops());

CREATE POLICY "blocked_slots: admin/ops update"
  ON public.blocked_slots FOR UPDATE
  USING (public.is_admin_or_ops());

CREATE POLICY "blocked_slots: admin/ops delete"
  ON public.blocked_slots FOR DELETE
  USING (public.is_admin_or_ops());
