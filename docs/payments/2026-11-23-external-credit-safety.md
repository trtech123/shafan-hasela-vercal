# External credit sale safety — release candidate

Production UI baseline checked on 23 November 2026: Vercel alias
`shafan-hasela-vercal.vercel.app` resolves to READY deployment
`dpl_AWXruZJmHvFB5Rm2HWbXzgmNmAdo`, source `ee1b82c`.

The deployed cashier screen offers `אשראי — חיצוני`. Its confirmation reaches a
browser `sales` INSERT, which creates a receipt without a provider transaction.
The 22 November read-only Production preflight in the payment integration branch
recorded browser INSERT grants on `sales` and authenticated EXECUTE on
`complete_manual_order_payment`. Recheck both privileges immediately before
release; the database may have changed since that observation.

This candidate removes external credit from the new-payment UI, disables the
other receipt-only tenders, accepts only cash/check in the noncard callback,
and removes the browser `sales` INSERT. The cash/check Edge path, Pelecard
paths, Payper ledger, checkout safety and historical report reads are retained.
Migration `202611230001_verified_sale_source_only.sql` reuses the reviewed
privilege boundary from `codex/payment-integration-20261122`, with a new unique
filename because the Production source baseline already includes a different
`202611220001` migration. It revokes direct client sale insertion and legacy
paid-order RPC execution while preserving service-role insertion. It contains
no financial-row INSERT, UPDATE or DELETE.

## Controlled release sequence

1. Reconfirm the Production alias/source, live grants, exact legacy RPC
   signature, active payment intents, recent financial writes and a recoverable
   backup. If the schema or grants differ, review before applying SQL.
2. With separate production authorization, apply only the reviewed SQL file.
   Confirm browser INSERT and legacy RPC EXECUTE are denied, service-role
   INSERT remains available, and counts of `sales`, `payment_transactions`
   and `payper_document_ledger` are unchanged.
3. Deploy only the exact reviewed application commit after the database guard
   is active. Do not redeploy payment Edge functions or change provider gates.
4. Read-only smoke check: external credit is absent, other receipt-only choices
   are disabled, and Pelecard, cash/check and historical receipt/report screens
   remain accessible. Real payment or document issuance needs its own approval.

Do not restore the browser INSERT grant as an automatic UI rollback; that would
reopen the original unsafe path. Restore the previous UI alias if necessary,
then investigate a narrow forward correction. Existing sales are retained.
