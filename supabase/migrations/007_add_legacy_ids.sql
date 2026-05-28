-- ============================================================
-- Migration 007: legacy_id staging columns for Base44 → Supabase data migration
--
-- SAFE / NON-DESTRUCTIVE: only ADDs nullable columns + unique indexes.
-- No data is changed. No existing column/constraint is dropped.
--
-- Purpose:
--   * legacy_id holds the original Base44 ObjectId on each row, so FK
--     relations can be remapped via SQL joins and re-imports stay idempotent
--     (upsert on legacy_id).
--   * legacy_assigned_to stages the original free-text assignee NAME for
--     tasks/maintenance (Base44 used names; Supabase assigned_to is a
--     profile UUID FK, which stays NULL until real logins exist).
--
-- Reversal (after migration, optional): see 00X_drop_legacy_ids.sql (not yet created).
-- ============================================================

ALTER TABLE public.activities        ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.instructors       ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.leads             ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.quotes            ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.orders            ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.tasks             ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.maintenance_tasks ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.sales             ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.pricing_sheets    ADD COLUMN IF NOT EXISTS legacy_id TEXT;

-- Stage original free-text assignee names (Q5).
ALTER TABLE public.tasks             ADD COLUMN IF NOT EXISTS legacy_assigned_to TEXT;
ALTER TABLE public.maintenance_tasks ADD COLUMN IF NOT EXISTS legacy_assigned_to TEXT;

-- Unique indexes on legacy_id enable idempotent upsert (ON CONFLICT legacy_id).
-- NULLs are distinct in Postgres, so existing seed rows (legacy_id IS NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_activities_legacy_id        ON public.activities(legacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_instructors_legacy_id       ON public.instructors(legacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_legacy_id             ON public.leads(legacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_legacy_id            ON public.quotes(legacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_legacy_id            ON public.orders(legacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_legacy_id             ON public.tasks(legacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_tasks_legacy_id ON public.maintenance_tasks(legacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_legacy_id             ON public.sales(legacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_sheets_legacy_id    ON public.pricing_sheets(legacy_id);
