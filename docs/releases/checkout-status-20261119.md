# Checkout status release candidate — 2026-11-19

Status: **prepared; do not migrate or deploy until every gate below passes and the owner approves this release.** This release never edits ORD-1062 or any other financial row. It excludes Direct J4 backend work and cashier payment-choice simplification.

## Source and scope

- Production deployment at preparation: `dpl_AQKAKWDGJvcp1s2YokgBVs2xffeP` (READY, CLI source). Its uploaded source content hashes for `Orders.jsx`, `Schedule.jsx`, `App.jsx`, `orderPayments.js`, `payperBilling.js`, `physical/client.js`, `pelecard-physical.js`, `pelecard-order.js`, `package.json`, `vite.config.js`, and `vercel.json` match commit `73690eee338b400bd9310e8fb283806852f43f29` after Windows CRLF normalization.
- Release branch: `codex/checkout-status-release-20261119`. The final release commit must be recorded after tests and review.
- One additive read-only RPC: `supabase/migrations/202611180002_order_financial_badges.sql`. It returns order totals, ledger-paid amounts, remaining balances and a collection state to authenticated users authorized for each order. It performs no table writes and grants no new table privileges.
- A stale `orders.payment_status='לא שולם'` does not override a verified partial or fully paid ledger balance. An unresolved payment/physical intent still yields `review` and blocks a second collection. A stored paid label with a missing ledger payment also yields `review`.
- Frontend changes: Orders list and details, Schedule order card, and read-only existing `sales.receipt_number` display in order details. Existing payment, POS, Payper, sales and accounting endpoints are unchanged.
- Compatibility rehearsal branch `codex/checkout-restoration-compat-20261119` applies status changes over restoration commit `9669eb5`; its `Orders.jsx` preserves the restoration voucher action. It is not the Production release source.

## Gates before approval and execution

1. Verify the Production alias still targets the recorded deployment and compare source file fingerprints again if the deployment changed. Rebase/review if its source changed.
2. Supabase Dashboard → project `divzxsynczeifkpnpupl` → Database → Backups: record the **completed** backup timestamp and visible Restore action. Timestamp must be after `2026-11-19 14:02:10 UTC` (ORD-1062 reconciliation). The `2026-11-18 17:34 UTC` backup is insufficient. Do not restore Production merely to test this release.
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
5. Require green full Vitest, migration rehearsal, full-schema rehearsal, focused lint on changed files, and build. Whole-repository lint currently has three pre-existing errors in `Leads.jsx`, `Templates.jsx`, and `Users.jsx`; these are outside this release.

## Approved execution sequence (not yet authorized)

1. Record current deployment ID, backup timestamp, schema preflight output and final release SHA in the release log.
2. Apply only `202611180002_order_financial_badges.sql` once as its single `BEGIN`/`COMMIT` transaction in the Production SQL Editor. Do not replay earlier migrations or run any payment/receipt action.
3. Read-only verify `to_regprocedure('public.get_order_financial_badges(uuid[])')` exists, its EXECUTE privilege is limited to authenticated callers, and a normal authenticated cashier can read a permitted order while an unrelated instructor cannot. Inspect ORD-1062: `state=paid`, `paidMinor=100`, `balanceMinor=0`. If any check fails, stop before deployment and investigate; do not alter financial records.
4. Deploy only the reviewed Production-based release SHA. Do not deploy the restoration compatibility rehearsal branch or any Direct J4 backend branch under this approval.
5. Read-only smoke test desktop and mobile Orders, order details and Schedule for paid, partial, unpaid and uncertain examples. On ORD-1062 expect green `התשלום בוצע`, no collection link and existing RCP-1048 in details. Confirm accounting, sale and Payper document 200006 remain visible and unchanged. Never click Pay during this smoke test.

## Rollback

If the UI fails, restore the previously recorded READY Vercel deployment/alias. The additive read-only RPC may remain installed while the prior UI runs; dropping it is a separate reviewed schema action, not an automatic rollback. Do not restore the old database backup, re-run a payment, resend an invoice or edit ORD-1062 as part of UI rollback. Preserve the deployment, migration and read-only smoke-test evidence for diagnosis.
