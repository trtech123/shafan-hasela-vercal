# Payper disabled release approval package — 2026-11-01

This runbook authorizes no production write. Candidate source is the clean
`release/payper-disabled-final-20261101` worktree, based on approved deployed
app source `4b0216ab99f76a29bd27dd04dd1e2d152a877436`. The final commit
SHA is recorded in the release approval response. The currently active Vercel deployment is
`dpl_9QmEQHhqvuuAbL7Dz5Sj4gqaT4vt`; preserve it as the recovery target.

## Exact scope

- Apply **only** `202611010001_payper_order_service_description.sql`. The three
  Payper migrations installed in October must never be replayed. The new trigger
  freezes the linked activity name for prospective order-payment snapshots;
  missing activity leaves checkout intact and creates an immediate durable
  manual-document-review obligation after verified payment success.
- Deploy **only** `payper-issuance-worker` as a new Edge function. Do not redeploy
  `pelecard-order-payment` v10 or any other Edge function. Its source already
  exists in the approved baseline. Leave `PAYPER_DISPATCH_ENABLED` and
  `PAYPER_WORKER_TOKEN` absent. The worker then responds unavailable before any
  database or provider call. Do not invoke it with a valid token and do not
  schedule it.
- Deploy the exact candidate Vercel app first with `--prod --skip-domain`, then
  promote its reviewed READY deployment only after the disabled and smoke gates.
  The app change adds an admin-only issued-document view. It neither sends mail
  nor changes the Admin/Cashier payment route.

## Read-only preflight; stop on any mismatch

1. Verify the final Git SHA and clean worktree. Compare `git diff --name-status
   4b0216ab99f76a29bd27dd04dd1e2d152a877436..HEAD` to the reviewed file
   list. Confirm the active Vercel domain still resolves to
   `dpl_9QmEQHhqvuuAbL7Dz5Sj4gqaT4vt`, READY, project
   `prj_6rvjmBAfEUpym5E4JwVPut1HiXQC`, scope `trtechs-projects`.
2. Confirm Supabase project `divzxsynczeifkpnpupl` is healthy, Pelecard
   order-payment v10 ACTIVE, Payper worker absent, and October ledger, activation,
   and Cashier RPCs present. Check actual definitions and grants; do not rely on
   an unreadable migration-history table.
3. Confirm control row `enabled=false`, `activation_cutoff_utc IS NULL`,
   `dispatch_remaining=0`; ledger and billing snapshot counts are still zero.
   Confirm the new trigger/function are absent and no Payper schedule exists.
   Verify existing accounting work before applying SQL. Inspect secret **names**
   only: dispatch and worker token must be absent. Never print values.
4. Record current app and Edge deployment IDs, schema definitions, control row,
   ledger counts, and an incident owner. Preserve a database backup. SQL rollback
   requires separate review; never delete accounting data as an automatic recovery.

## Approved execution sequence, only after separate authorization

1. From this exact worktree, apply the single reviewed migration with the
   authenticated Supabase CLI `db query --linked --project-ref
   divzxsynczeifkpnpupl --file
   supabase/migrations/202611010001_payper_order_service_description.sql`.
   It is transaction-wrapped. If output is uncertain, inspect actual function,
   trigger, and row state before any retry. Verify historical payment counts and
   disabled control values are unchanged.
2. Deploy `payper-issuance-worker` only, with `verify_jwt=false` as in
   `supabase/config.toml`; its own bearer-token check remains mandatory.
   Do not create `PAYPER_WORKER_TOKEN` or `PAYPER_DISPATCH_ENABLED` for this
   disabled release. Verify new version ACTIVE and an unauthenticated call is
   rejected/unavailable. No provider request is permitted.
3. Build from the pinned worktree. Create an unaliased Vercel production-target
   deployment with `--prod --skip-domain --scope trtechs-projects --project
   prj_6rvjmBAfEUpym5E4JwVPut1HiXQC`. Inspect deployment ID, source artifact,
   build logs, READY state, and core pages. Preview payment-status calls are
   expected to fail the production-only Edge CORS policy; do not relax CORS for
   this release or claim those calls passed. The payment page and Edge v10 are
   unchanged, so repeat authenticated status checks on the live domain after
   promotion.
4. Recheck dispatch OFF, cutoff NULL, allowance ZERO, no worker schedule, and no
   document. Confirm active production app is still the recorded old deployment.
   Promote **only** the inspected READY candidate. If promotion response is
   uncertain, inspect production alias before any further command; never retry
   blindly.
5. On the live domain, perform non-charging Admin/Cashier order-payment status
   checks, shift-manager server/database denial checks, admin accounting and
   issued-document view, orders, signing, cash register, clubs, and chatbot
   management checks. Do not create an order, payment, invoice, or WhatsApp
   message. Mark unavailable authenticated checks NOT TESTED. Recheck database
   control and ledger counts afterward.

## Recovery and stop rules

- On a preflight, SQL, Edge, preview, or promotion gate failure, stop. Leave
  dispatch absent and cutoff NULL. Do not replay October migrations or retry
  uncertain writes.
- If the new app regresses after promotion, inspect compatibility, then promote
  previous Vercel deployment `dpl_9QmEQHhqvuuAbL7Dz5Sj4gqaT4vt` only under
  the incident procedure. The additive description trigger may remain installed
  while disabled; any SQL reversal requires a separately reviewed change.
- If the worker is unexpectedly callable, remove its route/deployment under
  incident control and verify the database gates remain disabled. Never enable
  dispatch to test it.

## Still outside this release

No activation cutoff, one-document allowance, gateway POST, card charge,
customer delivery, recurring schedule, or Payper provider reconciliation is
authorized. A future supervised test still requires authoritative document
lookup after timeout, invoice date/VAT and delivery confirmation, and explicit
owner approval of one new order's exact payment amount and document consequence.
