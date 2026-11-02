-- Production activation step only. DO NOT run during disabled release.
-- Prerequisites: approved pg_cron + pg_net extensions; Vault secrets named
-- payper_worker_url (exact HTTPS Supabase worker URL) and payper_worker_token.
-- The token is never written into this file or a cron command literal.
-- The scheduled POST has no payment ID: the worker selects one durable ledger
-- candidate. The database cutoff, mode, and one-shot reservation remain final gates.
DO $install$
DECLARE job_id bigint;
BEGIN
 IF (SELECT count(*) FROM vault.decrypted_secrets
     WHERE name IN ('payper_worker_url','payper_worker_token')
       AND nullif(decrypted_secret,'') IS NOT NULL) <> 2
 THEN RAISE EXCEPTION 'payper_recovery_vault_secrets_required'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='payper-eligible-recovery')
 THEN RAISE EXCEPTION 'payper_recovery_already_installed'; END IF;
 SELECT cron.schedule('payper-eligible-recovery','* * * * *', $job$
   SELECT net.http_post(
     url := (SELECT decrypted_secret FROM vault.decrypted_secrets
       WHERE name='payper_worker_url'),
     headers := jsonb_build_object('Authorization', 'Bearer ' ||
       (SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name='payper_worker_token'),
       'x-payper-mode', 'automatic'),
     body := '{}'::jsonb);
 $job$) INTO job_id;
 IF job_id IS NULL THEN RAISE EXCEPTION 'payper_recovery_schedule_failed'; END IF;
END $install$;

-- Emergency recovery: first disable the Edge dispatch gate and call the
-- service-role stop_payper_dispatch(admin_uuid) RPC. Then, if necessary:
-- SELECT cron.unschedule('payper-eligible-recovery');
