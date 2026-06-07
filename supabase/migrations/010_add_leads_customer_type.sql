-- ============================================================
-- Migration 010: Add leads.customer_type
--
-- Phase A: leads are organized by customer type, not site.
-- New nullable TEXT column with a CHECK list of the four
-- allowed values. The column is NOT in the Base44 Lead entity
-- (reference/base44/entities/Lead.jsonc) — it is a conscious,
-- net-new field per Rule B.
--
-- NULL stays allowed so all 36 existing/legacy leads remain
-- valid with no backfill. The user classifies old leads later
-- via the "ללא סיווג" filter in the UI.
--
-- Mirrors the existing leads_site_check pattern: nullable TEXT
-- + CHECK list (the project's chosen pattern over Postgres ENUM,
-- see migration 006 enum-drift history).
-- ============================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS customer_type TEXT;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_customer_type_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_customer_type_check
  CHECK (
    customer_type IS NULL
    OR customer_type IN ('סוכן', 'מפיק', 'חינוכית', 'חברה')
  );
