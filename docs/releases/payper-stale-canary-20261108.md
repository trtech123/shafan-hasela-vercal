# Stale Payper canary retirement

Scope: migration `202611080002_payper_stale_canary_retirement.sql`, the
`payper-issuance-worker` revision, and the Admin Accounting status component.
This release does not activate continuous issuance or create an invoice.

1. Confirm the current Vercel production deployment and uploaded source, the
   installed `202611080001` manual-hold table, the exact canary target and its
   payment/intent/ledger state, and the absence of in-flight reservations.
   Preserve the existing deployment and Edge worker version for recovery.
2. Apply only `202611080002`. Installation must leave the control row, cutoff,
   target, allowance, ledger, documents, and existing audits unchanged. Check
   `to_regprocedure('public.retire_canceled_payper_canary()')` and the new
   empty audit table. Do not replay previous migrations.
3. Deploy only the reviewed worker. Its next authenticated automatic scan calls
   the retirement RPC before listing candidates. The RPC turns dispatch OFF
   only if the targeted POS payment is `failed/cashier_cancelled`, has no
   provider session, transaction, verification, sale, or Payper ledger. It
   appends one immutable retirement record. Any uncertainty leaves the gate
   unchanged for manual investigation.
4. Deploy the matching application candidate from the repository root. Verify
   Admin Accounting shows the canceled-target warning. Check Admin and Cashier
   non-charging navigation, Orders, POS, Accounting, Clubs and WhatsApp. Promote
   only the reviewed candidate after these checks. POS checkout configuration
   remains unchanged.
5. Confirm the retirement audit has one row for the canceled target, dispatch
   is OFF, the old target and cutoff remain recorded, old paid sales and
   documents are unchanged, and the RCP-1025 exception remains visible.

To prepare another canary, use the already audited
`prepare_payper_next_canary` procedure only after every eligible obligation
since the previous cutoff is resolved or placed on an explicit accountant
hold. Create a new payment after its fresh cutoff and bind it before hosted
checkout. Do not retarget a paid or canceled payment. The successful automatic
document guard remains mandatory for `enable_payper_continuous`.

Recovery: keep dispatch OFF, inspect the retirement audit and worker logs,
restore the previous worker/app artifacts only for a regression. Do not erase
the migration, audit, cutoff, payment, or accounting records. Normal POS
checkout is independent of this Payper stop.
