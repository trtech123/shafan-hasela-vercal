# Pelecard pending-payment reconciliation: disabled release

Source: the reviewed commit containing migration
`202611030001_pelecard_pending_recovery.sql`. This runbook does not authorize
deployment, payment, invoice creation, or activation.

## Disabled deployment, after exact-release approval

1. Record current production Vercel deployment, Edge versions, migration list,
   Payper control, POS gates, and cron jobs. Confirm the two known payments
   `28b4786f-e722-40ae-9661-f3e805fc71bf` and
   `68a78d1c-8f79-4646-a5e4-4dfa201d20e8` remain outside automatic work.
2. Apply **only** `202611030001_pelecard_pending_recovery.sql` if unapplied.
   Verify `pelecard_pending_recovery_control.enabled=false` and `cutoff_utc IS NULL`.
   Do not call `start_pelecard_pending_recovery`.
3. Configure a fresh `PELECARD_PENDING_RECOVERY_TOKEN` in Supabase Edge Secrets
   and a matching Vault token privately. Set
   `PELECARD_PENDING_RECOVERY_ENABLED=false`. Configure the Vault URL for the
   exact new Edge Function. Do not print tokens or use payment-provider secrets
   as the recovery bearer token.
4. Deploy `pelecard-pending-recovery`, `pelecard-pos-feedback`,
   `pelecard-pos-payment`, and `pelecard-order-payment` from the reviewed tree.
   The latter bundles contain the existing callback parser and verification
   logic; the new worker reuses their guarded finalizers. Keep Payper dispatch,
   automatic wake, scan, customer email and POS initiation at their approved
   disabled values. A token-protected worker request must return HTTP 403 while
   its Edge gate is OFF. Do not install the cron schedule.
5. Deploy the matching Vercel app from the repository root to an unaliased
   preview; the Vercel project Root Directory remains `app`. Perform Admin and
   Cashier non-charging smoke checks for Orders, Cash Register, Accounting,
   Clubs, cafeteria/products and WhatsApp. Admin Accounting must show the new
   pending-payment review panel; Cashier must not receive the Admin alert or
   gain access to the Admin accounting RPC. Promote only after all mandatory
   checks pass.
6. Recheck exact deployment IDs, Edge versions, applied migration, zero active
   `pelecard-pending-recovery` cron jobs, disabled DB and Edge gates, and old
   payment/Payper ledger state. Keep prior Vercel and Edge snapshots.

## Later activation, separately authorized

First reconcile the existing uncertain payment with Pelecard merchant reports.
For a **new** approved purchase, call `start_pelecard_pending_recovery` once
with a verified Admin UUID; it records an immutable current UTC cutoff. Verify
it excludes all earlier payment and dispatch timestamps. Set the Edge gate
true, verify the private Vault URL and token, then install
`scripts/payments/install-pelecard-pending-recovery.sql`. Enable the separate
Payper wake/dispatch controls only under the approved new-payment canary plan.
The scan performs only `lookup`, `validate` and hosted-status reads; it can
finalize an existing verified payment but cannot initiate another charge.
Success enters the existing Payper ledger and wake. Unknown/declined results
remain unpaid and appear in Admin Accounting; uncertain Payper creation remains
held without automatic retry.

## Recovery and emergency stop

Set `PELECARD_PENDING_RECOVERY_ENABLED=false`, call
`stop_pelecard_pending_recovery(admin_uuid)`, then unschedule
`pelecard-pending-recovery` if present. Stop Payper dispatch and its scan under
the existing Payper runbook if invoice creation must also stop. An in-flight
verified callback or already claimed lookup can still finish; check payment,
sale and Payper ledgers before any further action. Do not reverse the migration
or delete audit rows. Restore the prior Vercel deployment or saved Edge
snapshots only if code-level recovery is required, leaving database controls
OFF and preserving the immutable cutoff.
