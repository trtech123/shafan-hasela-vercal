# Checkout status release candidate — 2026-11-19

Status: **prepared; do not migrate or deploy until every gate below passes and the owner approves this release.** This release never edits ORD-1062 or any other financial row. It excludes Direct J4 backend work and cashier payment-choice simplification.

## Source and scope

- Production deployment at integration: `dpl_2z6PRpf8qeD9wjECEi773XN43b3j` (READY), alias `shafan-hasela-vercal.vercel.app`, source commit `86dab2b1c9d1b6de8a61c39b5a42458557e5eb0b`. The Group A operational UI and instructor permissions are the protected baseline.
- Release branch: `codex/checkout-status-group-a-20261119`, created from that exact Production commit. Six checkout-status commits through `cce76e0` were applied without path conflicts. The final release commit must be recorded after tests and review.
- One additive read-only RPC: `supabase/migrations/202611180002_order_financial_badges.sql`. It returns order totals, ledger-paid amounts, remaining balances and a collection state to authenticated users authorized for each order. It performs no table writes and grants no new table privileges.
- A stale `orders.payment_status='לא שולם'` does not override a verified partial or fully paid ledger balance. An unresolved payment/physical intent still yields `review` and blocks a second collection. A stored paid label with a missing ledger payment also yields `review`.
- Frontend changes: Orders list and details, Schedule order card, and read-only existing `sales.receipt_number` display in order details. Existing payment, POS, Payper, sales and accounting endpoints are unchanged.
- Integration correction: re-fetch the verified balance whenever the order list is reloaded, even if it contains the same order IDs. This prevents a stale collection badge after an order-change event; a regression test covers the transition from unpaid to paid.
- The earlier `codex/checkout-restoration-compat-20261119` rehearsal and the old-baseline checkout branch are not the Production release source.

## Read-only Production preflight on 2026-11-19

- Supabase scheduled physical backup `2026-11-19 17:34:02 UTC` shows a Restore action. This is later than the ORD-1062 reconciliation. Its restorability was not tested by a restore; Storage objects are excluded. Recheck backup age and any later critical financial writes immediately before authorization to migrate.
- A read-only post-backup audit found zero rows created or updated after that timestamp in `orders`, `sales`, `payment_transactions`, `payment_transaction_events`, `physical_payment_intents`, `payper_document_ledger`, `accounting_documents`, `manual_order_payments`, `payper_noncard_payments`, `pelecard_live_audit`, `pelecard_test_payments`, and `immediate_accounting_payment_evidence`. This is a point-in-time observation, not a lock against later writes.
- The live schema has all 21 columns referenced by the new RPC across `orders`, `payment_transactions`, `physical_payment_intents`, and `sales`; `is_admin_or_ops()`, `is_cashier()`, and `get_my_instructor_id()` exist; `get_order_financial_badges(uuid[])` does not yet exist.
- ORD-1062 is unchanged: total ₪1, one succeeded ₪1 payment, linked ₪1 physical-terminal sale, physical intent `succeeded`, zero orphan sales/payments. The candidate's balance algorithm therefore returns `paid`, `paidMinor=100`, `balanceMinor=0`, displayed as `התשלום בוצע`. This is a read-only prediction until the migration is applied and the authenticated RPC is queried.

## Gates before approval and execution

1. Verify the Production alias still targets `dpl_2z6PRpf8qeD9wjECEi773XN43b3j` and rebase/review if its source changed.
2. Supabase Dashboard → project `divzxsynczeifkpnpupl` → Database → Backups: record the latest **completed** backup timestamp and visible Restore action. It must cover the ORD-1062 reconciliation and any subsequent critical financial changes. The 2026-11-19 17:34:02 UTC backup meets the first condition; compare it against current audit records before release. Do not restore Production merely to test this release.
3. In a read-only Production SQL Editor session, check the required schema and absence of this RPC:

```sql
SELECT to_regprocedure('public.get_order_financial_badges(uuid[])') AS existing_badge_rpc,
       to_regprocedure('public.is_admin_or_ops()') AS admin_ops,
       to_regprocedure('public.is_cashier()') AS cashier,
       to_regprocedure('public.get_my_instructor_id()') AS instructor;
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND (
  (table_name='orders' AND column_name IN ('id','order_number','total_price','payment_status','status','archived_at','instructor_id')) OR
  (table_name='payment_transactions' AND column_name IN ('id','order_id','operation','status','amount','checkout_snapshot')) OR
  (table_name='physical_payment_intents' AND column_name IN ('payment_id','state')) OR
  (table_name='sales' AND column_name IN ('order_id','payment_transaction_id','method','total','receipt_number','linked_order_info'))
) ORDER BY table_name,column_name;
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies WHERE schemaname='public' AND tablename IN
  ('orders','sales','payment_transactions','physical_payment_intents')
ORDER BY tablename,policyname;
```

Stop if a helper function or column is missing, the new RPC already exists with unknown provenance, or current financial schema differs from the reviewed migration. The RPC runs as a definer with an empty `search_path`, explicit authenticated/profile guard, per-order admin/operations/cashier/instructor authorization, a 100-order limit, and EXECUTE only for `authenticated`; it does not rely on exposing the protected financial tables to the browser.

4. Confirm the release diff contains only the documented migration, frontend status/receipt changes, regression tests and this runbook. No API, worker, POS, Payper or financial write function may be present in the diff.
5. Require green checkout-status and payment regression tests, migration rehearsal, full-schema rehearsal, whole-app lint, and build. Recheck all gates on the final SHA.

## Approved execution sequence (not yet authorized)

1. Record current deployment ID, backup timestamp, schema preflight output and final release SHA in the release log.
2. Apply only `202611180002_order_financial_badges.sql` once as its single `BEGIN`/`COMMIT` transaction in the Production SQL Editor. Do not replay earlier migrations or run any payment/receipt action.
3. Read-only verify `to_regprocedure('public.get_order_financial_badges(uuid[])')` exists, its EXECUTE privilege is limited to authenticated callers, and a normal authenticated cashier can read a permitted order while an unrelated instructor cannot. Inspect ORD-1062: `state=paid`, `paidMinor=100`, `balanceMinor=0`. If any check fails, stop before deployment and investigate; do not alter financial records.
4. Deploy only the reviewed Production-based release SHA. Do not deploy the restoration compatibility rehearsal branch or any Direct J4 backend branch under this approval.
5. Read-only smoke test desktop and mobile Orders, order details and Schedule for paid, partial, unpaid and uncertain examples. On ORD-1062 expect green `התשלום בוצע`, no collection link and existing RCP-1048 in details. Confirm accounting, sale and Payper document 200006 remain visible and unchanged. Never click Pay during this smoke test.

## Rollback

If the UI fails, restore the previously recorded READY Vercel deployment/alias. The additive read-only RPC may remain installed while the prior UI runs; dropping it is a separate reviewed schema action, not an automatic rollback. Do not restore the old database backup, re-run a payment, resend an invoice or edit ORD-1062 as part of UI rollback. Preserve the deployment, migration and read-only smoke-test evidence for diagnosis.
