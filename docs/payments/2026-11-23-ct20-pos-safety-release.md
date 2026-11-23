# 23 November 2026 — standalone CT20 POS safety release

## Production audit and scope

- The operator's EFS audit `payment-preflight-20261123T182615Z.txt` showed 32 orders, 43 sales, 30 payment transactions, 11 Payper ledger rows, no active physical intent, CT20 004 on `GENERAL`, and the old sale/RPC grants open.
- The controlled permission helper stopped before its migration at 18:37 UTC. Its EFS audit `verified-sale-source-20261123T183731Z.txt` showed the browser sale INSERT and authenticated legacy RPC EXECUTE grants had become false. The actor who changed them was not established by this audit.
- The separate read-only EFS audit `verified-sale-source-readonly-20261123T184433Z.txt` verified the intended poststate: `anon` and `authenticated` cannot INSERT `sales`; `service_role` can; `anon`, `authenticated` and `service_role` cannot execute the retired manual-order RPC. Counts remained 32/43/30/11, all inspected RLS/guard/index checks passed, and no unresolved physical intent or timestamped change in inspected financial/order rows appeared since the encrypted backup. **No migration was run by this release.**
- During the checks, Production changed first to CLI deployment `dpl_HDuLQuV1jGCWE8NEpKxpa3j9dq4F` and then to READY CLI deployment `dpl_BHr2WGiKSQee36ZNZshcvKBf3EmW`. Source-file hashes and the deployment tree correlated the latter with the `ee46f93` landing branch, which includes external-credit safety based on `e38083f`; CLI metadata did not contain a Git SHA. The isolated application candidate was rebased through a merge on `ee46f93`, preserving both concurrent releases.
- The released app change only prevents standalone physical POS preparation when no verified sale site is persisted. Order-based CT20 preparation and read-only status/recovery remain available. No financial data, provider settings, Supabase Edge Function, invoice or migration was changed.

## Local verification

- Production-based isolated branch: `codex/payment-safety-after-external-20261123`; deployed commit: `140d0e1419cbf1787aebd6af2ef13ab424dcc31d`.
- Physical HTTP/runtime tests: 20/20 passed. Full Vitest after preserving the landing release: 181 files, 1,383 tests passed. `npm run lint` and `npm run build` passed. Isolated migration rehearsal passed. Full-schema rehearsal passed 107 migrations, 90 tables, 316 functions, 145 policies, 132 triggers, 1,325 constraints, zero unvalidated constraints.
- Two pre-existing test expectations from the external-credit release were updated to assert the current protected behavior: no browser sale INSERT and no external-card button. The first full run exposed only those two stale expectations; their focused rerun passed 8/8, followed by the clean full run above.

## Deployment and read-only smoke test

- Vercel deployment `dpl_A4Gw9YcH1vc8Q4Vj6PUrn5zumcJ6` reached READY with Git SHA `140d0e1419cbf1787aebd6af2ef13ab424dcc31d`; the Production alias `shafan-hasela-vercal.vercel.app` was checked twice and points to this deployment.
- In an authenticated Admin Production browser, the accounting page loaded with the existing ORD-1062 payment, RCP-1048 and Payper 200006, six Payper exceptions and three Pelecard investigations. Rivhit intake and transmission remained off.
- In standalone cashier UI, a local-only pizza cart showed hosted Pelecard as selectable. CT20 standalone was absent; cash, cheque, transfer, Bit/Paybox, deferred invoice and split were disabled; external card was absent. No Pay action was clicked. The temporary local cart was cleared by page reload.
- Orders showed ORD-1062 as `התשלום בוצע`, ORD-1064 as `תשלום בבדיקה`, and ORD-1060 as unpaid with `גבייה בקופה`. Customers, club attendance, quotations and leads pages loaded. The sales report loaded and showed no sales in the current week at the observation time. These are read-only UI checks, not live payment acceptance.

## Rollback boundary and remaining acceptance

If a verified application regression emerges, the prior READY application deployment is `dpl_BHr2WGiKSQee36ZNZshcvKBf3EmW`; recheck its alias and assess impact before moving traffic. Keep the already verified SQL privilege restrictions in place. Do not restore the database or reopen browser sale INSERT as an application rollback.

The change closes an unsafe path; it does not activate a payment method. Routine live use still needs method-specific acceptance and provider/document evidence. Standalone CT20 awaits a persisted, verified site contract. Cash POS and cheque remain gated, and external/deferred/split routes remain blocked pending business and accounting decisions. Existing six Payper exceptions and three Pelecard attempts remain in manual investigation without automatic retries.
