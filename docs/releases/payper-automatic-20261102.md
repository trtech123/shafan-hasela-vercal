# Payper automatic issuance: controlled production release

Source base: `b7a9b7d0d43382be9c859121f776f5983bdf4a9c`.
This release is disabled on install. It must not be combined with a real charge
or invoice until the owner approves the exact canary payment.

## Deploy disabled

1. Confirm the production Vercel deployment, Edge versions, migration list,
   `payper_dispatch_control` (`enabled=false`, cutoff `NULL`, remaining `0`),
   `PELECARD_POS_PAYMENTS_ENABLED=false`, and all Payper wake/scan/dispatch
   switches false. Capture recovery IDs. Stop if any prerequisite changed.
2. Apply only `202611020002_payper_automatic_dispatch.sql`. Verify it installs
   `dispatch_mode=disabled`, `canary_payment_id=NULL`, cutoff `NULL`, and leaves
   all existing ledger rows unchanged. Do not replay installed migrations.
3. Deploy the reviewed `payper-issuance-worker` revision with dispatch, auto
   scan, and wake switches false. Verify unauthorized calls return 401 and an
   automatic-mode call returns 403; do not submit a target payment.
4. Deploy the matching Vercel application to an unaliased preview from the
   repository root (project Root Directory is `app`). Complete Admin and
   Cashier non-charging smoke checks; promote only that reviewed candidate.
   Confirm the accounting exception link is admin-only and the POS gate stays
   off. Leave the existing order-payment and POS Edge versions in place unless
   an exact source diff requires replacement.
5. Keep `PAYPER_WORKER_TOKEN`, `PAYPER_SEND_BY_MAIL`, schedule, and all activation
   switches absent/false until the separately authorized activation window.

## One targeted canary, only after explicit financial approval

1. Confirm a genuine purchase of active catalog item `טופי/סוכריות` at ₪3.00
   VAT-inclusive, accountant-approved description, and verified legal billing
   name, identity, and email entered privately in the application. Check no
   existing Payper or Rivhit document for the selected payment and provider
   `trxRecordId`. Do not use `000000000` or invented identity data.
2. During a controlled checkout window, configure one strong server-only
   `PAYPER_WORKER_TOKEN` for the worker and payment Edge functions. Put the same
   token and exact worker HTTPS URL in Supabase Vault under the names in
   `scripts/payments/install-payper-recovery.sql`. Restrict database roles that
   can inspect pg_net's request queue. Verify the token never reaches Vercel
   client code. Confirm the Payper terminal and documented `send_by_mail`
   setting with the provider; enable `PAYPER_SEND_BY_MAIL=true` only if approved.
3. Enable POS initiation in both Edge and Vercel only for authorized staff.
   Enable `PAYPER_DISPATCH_ENABLED=true` and `PAYPER_AUTO_WAKE_ENABLED=true` on
   Supabase Edge. Keep `PAYPER_AUTO_SCAN_ENABLED=false` until the schedule is
   reviewed. Invoke `activate_payper_new_payments(admin_uuid)` once from a
   trusted service-role session; record its immutable UTC return value. This
   sets canary mode and allowance one but cannot dispatch without a target.
4. Begin hosted POS checkout **without entering card details yet**. Record the
   new payment UUID. Call `target_payper_canary(admin_uuid,payment_uuid)` from
   the trusted session; verify the target, amount, source, customer snapshot,
   and cutoff. Check for other new eligible rows before continuing. No other
   payment can consume the canary reservation.
5. Install the reviewed recovery schedule using
   `scripts/payments/install-payper-recovery.sql`, then set
   `PAYPER_AUTO_SCAN_ENABLED=true`. Complete one authorized real card payment.
   Do not invoke the worker manually. The verified finalizer creates the ledger
   row and wakes the worker; the scheduled scan recovers a missed wake.
6. Verify the sale, provider transaction and `trxRecordId`, one Payper ledger
   success, document number/link, actual issue date, legal identity, item,
   amount ₪3.00, regular VAT, and customer email receipt if enabled. Check
   accounting UI under an Admin account. Document issuance does not itself
   prove email delivery; inspect the mailbox/provider delivery evidence.

## Continuous mode: separate approval after canary review

1. Review the canary document and all Payper/Rivhit records. Confirm no
   unresolved or delayed non-canary payment, aged pending row, or scheduler
   error. Obtain separate owner approval for continuous invoicing.
2. Invoke `enable_payper_continuous(admin_uuid)` from the trusted service-role
   session. The database refuses unless the targeted canary ledger row has a
   saved document number and URL. Continuous mode does not use an arbitrary
   global quota; each verified payment still requires its own one-shot ledger
   reservation and existing duplicate-document fences.
3. Keep wake and scan enabled. The scheduled scan processes one oldest eligible
   row per minute, while finalization wakes each new payment immediately.
   Monitor queue age, `source_blocked`, `reconciliation_required`, aged
   `dispatch_reserved`, missing-ledger rows, worker errors, and cron/net job
   failures. The global Admin alert links to the accounting exception list.

## Emergency shutdown and reconciliation

Immediately set the Edge `PAYPER_DISPATCH_ENABLED=false` and call
`stop_payper_dispatch(admin_uuid)` from a trusted service-role session. Turn
off POS payment initialization if payment checkout itself must stop. Disable
the automatic scan and unschedule `payper-eligible-recovery` if needed. Verify
the gates, cutoff, ledger, provider records, and cron status. Do **not** reset
or backdate the cutoff and do not reverse the migration blindly. A reserved or
uncertain Payper request is never retried automatically; reconcile it against
authoritative provider evidence or Payper support before any separately
reviewed manual action. Restore the previous Vercel deployment and saved Edge
snapshots only for code rollback, leaving the database migration in place.

No provider API in this source provides authoritative invoice absence by
`trxRecordId`. The Payper reporting UI can search documents by customer,
subject, date, and amount; absence from that UI alone does not authorize a
second creation request. If authoritative absence cannot be established,
hold the payment in `reconciliation_required` and escalate to accounting.
