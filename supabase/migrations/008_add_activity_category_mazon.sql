-- ============================================================
-- Migration 008: add 'מזון' to the activities.category CHECK
--
-- SAFE / NON-DESTRUCTIVE: only WIDENS the allowed category set.
-- The real Base44 catalog includes catering items categorized as 'מזון'
-- (3 of 15 activities), which 001's CHECK omitted. Without this, those
-- rows fail to insert.
--
-- ⚠ FOLLOW-UP (frontend, separate change — NOT done here):
--   add 'מזון' to the category dropdown + color map so these activities
--   are editable in the UI:
--     - app/src/components/activities/ActivityFormDialog.jsx (category <Select>)
--     - app/src/pages/Activities.jsx (category color map, if present)
--
-- Alternative if you'd rather NOT add the category: remap 'מזון' to an
-- existing category in the importer instead of applying this migration.
-- ============================================================

ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_category_check;

ALTER TABLE public.activities
  ADD CONSTRAINT activities_category_check
  CHECK (category IN ('הפעלת פארק', 'יום גיבוש', 'חוג טיפוס', 'סדנת שטח', 'מזון'));
