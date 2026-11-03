-- Separate activation only, never part of the disabled release. After migration
-- 202611030003, first set and verify a NEW audited future cutoff with
-- start_pelecard_pending_recovery(admin_uuid). This call requires recovery to
-- be stopped; do not install this schedule if the returned cutoff is old.
-- Then enable PELECARD_PENDING_RECOVERY_ENABLED in Edge secrets. The callback and
-- payment finalizers still require authoritative Pelecard evidence.
-- Vault must contain pelecard_pending_recovery_url and
-- pelecard_pending_recovery_token; never embed values in this schedule.
DO $install$
DECLARE job_id bigint;
BEGIN
  IF (SELECT count(*) FROM vault.decrypted_secrets
      WHERE name IN ('pelecard_pending_recovery_url','pelecard_pending_recovery_token')
        AND nullif(decrypted_secret,'') IS NOT NULL)<>2
  THEN RAISE EXCEPTION 'pending_recovery_vault_secrets_required'; END IF;
  IF (SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name='pelecard_pending_recovery_url') IS DISTINCT FROM
      'https://divzxsynczeifkpnpupl.supabase.co/functions/v1/pelecard-pending-recovery'
  THEN RAISE EXCEPTION 'pending_recovery_url_mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='pelecard-pending-recovery')
  THEN RAISE EXCEPTION 'pending_recovery_already_installed'; END IF;
  SELECT cron.schedule('pelecard-pending-recovery','* * * * *',$job$
    SELECT net.http_post(
      url:=(SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name='pelecard_pending_recovery_url'),
      headers:=jsonb_build_object('Authorization','Bearer '||
        (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name='pelecard_pending_recovery_token')),
      body:='{}'::jsonb);
  $job$) INTO job_id;
  IF job_id IS NULL THEN RAISE EXCEPTION 'pending_recovery_schedule_failed'; END IF;
END $install$;

-- Emergency shutdown: set PELECARD_PENDING_RECOVERY_ENABLED=false, then call
-- stop_pelecard_pending_recovery(admin_uuid), then unschedule if needed:
-- SELECT cron.unschedule('pelecard-pending-recovery');
