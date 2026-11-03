# Pending-payment recovery epoch: disabled database release

## Scope

Apply only `supabase/migrations/202611030003_pelecard_pending_recovery_epoch.sql` to project `divzxsynczeifkpnpupl`, after separate approval. No application, Edge Function, secret, or schedule change is part of this release. Do not replay earlier migrations. The migration repairs the existing recovery activation RPC so each stopped activation uses a new UTC cutoff, and records all cutoffs in an append-only audit. It does not start recovery.

## Preconditions

1. Confirm migration `202611030001_pelecard_pending_recovery.sql` is installed and `202611030003` is not.
2. Confirm Payper dispatch, automatic wake and scan, pending-payment recovery, and POS initiation are OFF in their database, Edge, and Vercel controls. Confirm no recovery or Payper cron job exists and no recovery claim lease is active.
3. Preserve the previous production deployment, Edge versions, migration list, control rows, and audit evidence. Keep RCP-1020 and all prior pending payments on manual review.

## Apply and verify

1. Apply the reviewed `202611030003` SQL exactly once in a transaction. Stop on any migration error.
2. Verify the existing recovery cutoff appears once in `pelecard_pending_recovery_epoch_audit` with `origin='legacy'`; the recovery control must remain `enabled=false` with its original cutoff unchanged.
3. Confirm the other financial gates remain OFF and no schedule was installed. Do not call `start_pelecard_pending_recovery` in this disabled release.

## Later canary activation, under its own authorization

1. Confirm all older pending payments predate the new UTC cutoff, no recovery claim lease is active, and no recovery schedule exists. Keep Edge and Vercel gates OFF while preparing.
2. Call `start_pelecard_pending_recovery(admin_uuid)` with service role, record the returned *new* cutoff, and verify the new audit row. Stop if it is not later than every payment intended for exclusion.
3. Only after a NEW server-frozen POS payment UUID is targeted by the separate Payper canary control, enable the explicitly approved Edge gates and recovery schedules. The recovery worker remains read-only at Pelecard and never repeats a charge. It may finalize only authoritative successful results and then wake the existing Payper queue.
4. After the canary or on any failure, disable the Edge gates, call `stop_pelecard_pending_recovery(admin_uuid)` and `stop_payper_dispatch(admin_uuid)`, unschedule both jobs, disable the Vercel POS gate and redeploy the same approved source. Preserve all cutoffs and audit rows. Hold uncertain payment and invoice outcomes for manual reconciliation; never blindly retry.

## Recovery

This migration adds an auditable epoch and does not change a payment or invoice. If application checks fail, leave recovery and invoice gates OFF and keep the schema installed. Do not blindly reverse a production migration or backdate a cutoff. Investigate and release a reviewed forward correction if needed.
