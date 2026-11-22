-- PREPARED ONLY. Apply solely after Anat approves the exact mappings and
-- management authorizes financial activation. Applying this migration alone
-- does not capture sources, stage entries, or post journals.
BEGIN;

ALTER TABLE public.rivhit_journal_control
  DROP CONSTRAINT rivhit_journal_control_capture_enabled_check,
  DROP CONSTRAINT rivhit_journal_control_posting_enabled_check;

ALTER TABLE public.rivhit_journal_control
  ADD CONSTRAINT rivhit_journal_control_capture_requires_cutover
  CHECK (NOT capture_enabled OR cutover_at IS NOT NULL);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.rivhit_journal_control
    WHERE capture_enabled OR posting_enabled OR cutover_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.rivhit_journal_approved_mappings)
    OR EXISTS (SELECT 1 FROM public.rivhit_journal_sources)
    OR EXISTS (SELECT 1 FROM public.rivhit_journal_entries) THEN
    RAISE EXCEPTION 'rivhit_journal_activation_preflight_failed';
  END IF;
END $$;

COMMIT;
