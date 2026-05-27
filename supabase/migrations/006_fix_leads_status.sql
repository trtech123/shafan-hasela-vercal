-- ============================================================
-- Migration 006: Fix leads.status CHECK constraint
--
-- Migration 001 used values from the Base44 entity definition
-- ('פתוח','טופל','לא רלוונטי'), but the actual UI uses
-- ('פתוח','נשלח','נסגר','לא רלוונטי').
-- The UI is the source of truth — update the constraint.
-- ============================================================

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_status_check
  CHECK (status IN ('פתוח', 'נשלח', 'נסגר', 'לא רלוונטי'));
