-- ============================================================
-- Migration 011: Widen leads.site CHECK to current business sites
--
-- 001 left leads.site on the legacy list ('עכו','טבריה','שטח',
-- 'ויה פרטה') — missing 'נוף הגליל', so a lead could not be set
-- to it. This widens the list to the full current set of real
-- business sites. 'ויה פרטה' is a real site and is kept.
--
-- Result allows: 'עכו','טבריה','נוף הגליל','שטח','ויה פרטה' + NULL.
-- No data rewrite, no backfill (superset of the prior list).
-- ============================================================

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_site_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_site_check
  CHECK (
    site IS NULL
    OR site IN ('עכו', 'טבריה', 'נוף הגליל', 'שטח', 'ויה פרטה')
  );
