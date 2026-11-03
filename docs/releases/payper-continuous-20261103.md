# Future-only continuous Payper issuance

Source: the commit containing `202611030002_payper_repeatable_epoch.sql`.
This runbook does not authorize deployment, payment, invoice creation, email,
schedule installation, or activation. Keep RCP-1020 and payment
`68a78d1c-8f79-4646-a5e4-4dfa201d20e8` on manual review. Do not backfill.

## Disabled release, after exact-release approval

1. Record the current production Vercel deployment and Edge versions, installed
   migration list, `payper_dispatch_control`, latest activation audit row,
   Payper and pending-payment ledgers, cron jobs, and Edge gate states. Require
   Payper dispatch, automatic wake and scan, pending-payment recovery, and POS
   initiation OFF. Preserve the current app and Edge artifacts for recovery.
2. Apply **only** `202611030002_payper_repeatable_epoch.sql` after confirming
   `202611020004` and `202611030001` are installed. Do not replay migrations.
   Do not call `prepare_payper_next_canary`. Confirm the original cutoffs,
   target, allowance, old ledger rows, invoice counts, and audit row count are
   unchanged. This migration changes no Edge or Vercel artifact.
3. With all gates still OFF, verify service-role/admin authorization, that the
   effective cutoff equals the latest existing audit row, and that no new
   dispatch candidate is returned. Record the migration ID and control state.

## New supervised canary, after separate financial approval

1. Verify a genuine catalog item, exact VAT-inclusive checkout total, real
   legal customer identity and billing email entered privately in the app,
   accurate description, merchant Payper capability, worker token, Vault URL
   and token, and no existing document for the new payment. Confirm the old
   unresolved payments remain held. Authorize the exact charge, invoice and
   optional `send_by_mail` consequence before any checkout.
2. Call `prepare_payper_next_canary(admin_uuid)` once from a trusted service-role
   session. This requires dispatch OFF and no unresolved dispatch reservation
   or eligible, frozen, or missing-ledger obligation since the previous cutoff.
   It appends a strictly newer immutable UTC cutoff. Verify the audit row,
   target NULL, mode canary, allowance 1, and that old payments cannot enter
   the queue. Keep the Edge Payper dispatch switch OFF until targeting.
3. Open the approved POS or Orders hosted checkout window. Save **one** new
   intent without entering card data. Verify server-frozen amount, VAT,
   description, billing snapshot and new payment UUID. Call
   `target_payper_canary(admin_uuid,payment_uuid)` and independently verify
   the target equals that UUID before enabling the worker gate.
4. Enable the approved POS gate if the checkout is POS; Orders uses its
   separate existing live gate. Enable `PAYPER_DISPATCH_ENABLED`,
   `PAYPER_AUTO_WAKE_ENABLED`, `PAYPER_AUTO_SCAN_ENABLED`, and, only if approved,
   `PAYPER_SEND_BY_MAIL`. Enable `PELECARD_PENDING_RECOVERY_ENABLED` after its
   separate immutable cutoff is set. Confirm the two cron jobs from
   `scripts/payments/install-payper-recovery.sql` and
   `scripts/payments/install-pelecard-pending-recovery.sql` are installed once
   with verified Vault names and tokens. Keep mode `canary` and target fixed.
5. The owner alone completes one hosted payment. Require authoritative Pelecard
   verification and exactly one sale/order finalization. Observe automatic
   wake or scheduled recovery, without manually invoking the invoice worker.
   Verify one Payper ledger success, Invoice-Receipt number and URL, customer,
   description, gross amount, VAT, issue date, Admin Accounting visibility,
   and provider/mailbox evidence for approved email delivery. If payment or
   document status is uncertain, stop the gates and reconcile manually; never
   retry a possible document request blindly.

## Continuous activation, after successful canary and separate approval

Inspect held, pending and missing-ledger exceptions. Require the targeted
canary's saved document number and URL. Call
`enable_payper_continuous(admin_uuid)` from a trusted service-role session.
Verify mode `continuous`, the same latest immutable cutoff, no payment target
filter in candidate selection, and the database's one-shot reservation for
each new verified POS or Orders payment. Keep automatic wake and both recovery
schedules active. Monitor queue age, worker and cron/net failures, payment
holds, missing billing, definitive provider failures, and uncertain results in
Admin Accounting. A failed invoice must not block unrelated eligible payments.

## Stop and recovery

First set `PAYPER_DISPATCH_ENABLED=false`, then call
`stop_payper_dispatch(admin_uuid)`. Disable automatic wake and scan, and
unschedule `payper-eligible-recovery` when required. To stop missed-payment
reconciliation, set `PELECARD_PENDING_RECOVERY_ENABLED=false`, call
`stop_pelecard_pending_recovery(admin_uuid)`, and unschedule its job. Close
POS initiation if checkout must stop. Inspect any in-flight reservation before
further action. Restore saved app or Edge versions only for a code regression;
leave migrations, immutable cutoffs, payment and document audit rows intact.
