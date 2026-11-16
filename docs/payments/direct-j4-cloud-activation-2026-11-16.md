# Direct J4 cloud payment candidate — 16 November 2026

## Scope and evidence

This branch starts at verified hosted EMV release source `641c373c124f6b283b7dc0afad0ba86604b074e8`. It leaves the hosted route, digital payment path, cashier page and production financial settings intact. The previous disabled direct J4 adapter, physical intent table, register lock, order reservation, and verified sale finalizer are reused.

Pelecard support confirmed on 16 November 2026 that `DebitRegularType` (J4) with `ShopNumber` set to the register, for example 4, and no card details sends the transaction to the device. Support also said the invoice number and link arrive only in the first `DebitRegularType` response. The local official Services REST manual (January 2025, DebitRegularType J4 section) shows the empty card fields and `PayperParameters` in one J4 request. This establishes a supported request shape; it does **not** establish Payper activation, exact success response, automatic Invoice-Receipt issuance or delivery for merchant terminal `2814926015`, CT20 register `004`. A merchant-specific written confirmation and controlled live acceptance remain mandatory.

Official references: [Pelecard Payper integration](https://docs.pelecard.com/documentation/payper-integration/), [Create Payper Invoice](https://docs.pelecard.com/documentation/create-payper-invoice-api/), [Vercel function duration](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes), [Vercel cron jobs](https://vercel.com/docs/cron-jobs).

## Candidate flow

The cashier's eventual direct action reserves a server-priced payment for the selected order. The existing unique request key and one-unresolved-intent-per-register lock prevent duplicate clicks and concurrent terminal sends. A cloud cron invocation claims the reserved direct intent once and POSTs J4 with the validated amount, `shopNumber: "004"`, `paramX` equal to the intent ID, and empty card fields. With `PELECARD_PHYSICAL_DIRECT_PAYPER_ENABLED=true`, the request also includes the existing frozen order invoice lines, customer details and VAT decision as `PayperParameters`. The first response is reduced to an allowlist and saved before the worker changes the intent to pending. It includes provider identifiers, approval fields, amount, Payper status, number, link and document IDs when supplied. Opaque card data and raw provider responses are discarded.

The existing independent `CheckGoodParamXEMV` and `GetTransDetailsEMV` lookup validates amount, merchant terminal, register and provider identifiers before the existing atomic finalizer creates a sale and updates the existing order. The first-response invoice is associated through the one-document ledger only after verified payment and sale, with matching transaction and amount. Invoice failure keeps the payment and sale while retaining a reconciliation hold. A timeout or interrupted response remains uncertain. Recovery performs lookup and finalization only; it never sends J4 again and never calls `CreatePayperInvoice` automatically.

The cloud candidate uses the existing Vercel project, a protected minute cron route, direct physical credentials, and the existing database. It is disabled unless `PELECARD_PHYSICAL_CLOUD_WORKER_ENABLED=true`; financial dispatch has its separate existing gate. The route requests 360 seconds, leaving margin over the J4 five-minute wait. Vercel's current published change supports this on Pro/Enterprise with Fluid Compute; Hobby's 300-second maximum cannot satisfy the margin. Verify the actual project plan and Fluid Compute configuration before deploying this route. No new paid service is authorized here. The cron response reports processed, failed and unresolved counts; the database retains intent state for recovery and audit. A minute cron may take up to roughly one minute to start a new reserved payment. If that delay is unacceptable, a separately approved durable immediate trigger is needed.

## Current activation blockers

1. Pelecard must confirm for **this merchant's physical J4 credentials and CT20 register 004** that `PayperParameters` in the same empty-card `DebitRegularType` request automatically creates and emails an `Invoice-Receipt`, and provide redacted examples of approved with invoice, approved with invoice error, decline, timeout/unknown and lookup results. Confirm `InvoiceStatus` values, `PelecardTransactionId`/`Uid` mapping, invoice link host and document identifiers. Do not send a separate invoice request while the original result is uncertain.
2. Verify the Vercel production project is already on a plan and runtime supporting a 360-second Node function and minute cron. If it is Hobby, keep direct dispatch disabled and choose an approved durable host. Do not buy or upgrade service automatically.
3. Coordinate the cashier integration with terminal 1 after its hosted EMV acceptance. The existing `CashRegister.jsx` calls `startHostedPhysical` and blocks the physical option for linked orders; this branch deliberately does not change terminal 1's active cashier file. `startDirectPhysical` is ready for terminal 1 to wire to the existing Pay action and inline waiting/status UI. The direct path must show no internal payment page or hosted PINPAD button. Preserve hosted EMV as fallback.
4. Confirm the controlled cashier, register assignment, customer VAT/billing snapshot and exact order balance for acceptance. Do not use this branch to charge ORD-1060.

## Production activation and acceptance procedure for terminal 1

1. Finish and record the current hosted EMV acceptance independently. Record its production source commit. Rebase or merge this branch onto that verified source after reviewing cashier changes; retain the hosted route and its disabled-by-default fallback settings. Review the diff for no digital/cash financial gate changes.
2. Obtain Pelecard's merchant-specific Payper/J4 confirmation and redacted response samples above. Compare samples against the first-response parser and EMV lookup parser. Resolve any field mismatch in synthetic tests before enabling a financial call.
3. Confirm Vercel Pro/Enterprise Fluid Compute and the 360-second function limit, cron frequency, `CRON_SECRET`, production runtime logs and existing dedicated physical database/CA connectivity. Set `PELECARD_PHYSICAL_WORKER_MAX_MS=360000`. Run the cloud route with `PELECARD_PHYSICAL_CLOUD_WORKER_ENABLED=false` and verify HTTP 503, no dispatch and no credential leakage. The existing local worker must remain off.
4. Rehearse migration `202611160001_direct_j4_first_response.sql` and all prior migrations in disposable PostgreSQL. Back up production, review the additive schema/function diff, then apply the migration through terminal 1's controlled migration process. This branch has **not** applied it to production.
5. Set `PELECARD_PHYSICAL_ENABLED=true`, the dedicated physical credentials and terminal `2814926015` in the Vercel server environment. Keep `PELECARD_PHYSICAL_DISPATCH_ENABLED=false`, `PELECARD_PHYSICAL_DIRECT_PAYPER_ENABLED=false`, `PELECARD_PHYSICAL_CLOUD_WORKER_ENABLED=false` and `VITE_PELECARD_PHYSICAL_ENABLED=false`. Keep the existing hosted EMV gates available as fallback. Confirm only CT20 register `004` is enabled and assigned to the cashier workstation. Use a synthetic order and mock provider for the full reserve/worker/recovery rehearsal. Never use a real card in this step.
6. After the provider and cloud checks pass, terminal 1 may set `PELECARD_PHYSICAL_CLOUD_WORKER_ENABLED=true` and `PELECARD_PHYSICAL_DIRECT_PAYPER_ENABLED=true` for a single controlled cashier, then set `PELECARD_PHYSICAL_DISPATCH_ENABLED=true` and enable the coordinated direct cashier UI with `VITE_PELECARD_PHYSICAL_ENABLED=true`. Keep hosted EMV available as fallback and ensure an unresolved direct intent blocks another payment on register 004.
7. Terminal 1 alone performs the intended controlled acceptance on **ORD-1060, ₪15, register 004**. Verify the order's unpaid balance, VAT and billing recipient before Pay. Click Pay once; confirm ₪15 appears on the CT20 without a hosted PINPAD button. After the customer pays, check the first J4 response evidence, independent EMV lookup, one payment transaction, one sale linked to ORD-1060, updated order balance/status, and one official Invoice-Receipt number/link in the ledger. Check the customer email separately. A decline must create no sale or invoice. An uncertain state must not permit another send.
8. Monitor `physical_payment_intents` for reserved older than two minutes, dispatching/pending older than six minutes, and any uncertain or approved intents; inspect the cron route's failed/unresolved counts and logs. Reconcile uncertain outcomes against Pelecard before a new charge. If the invoice is missing after verified approval, hold the sale for manual accounting review and do not issue another automatic document. Disable direct dispatch/browser gates if any correlation or accounting check fails; the hosted fallback remains available.

Read-only monitoring query after the migration:

```sql
SELECT i.payment_id, i.register_number, i.state, i.amount_minor,
  i.verified_amount_minor, i.dispatch_started_at, i.updated_at,
  i.first_response->'document'->>'state' AS first_document_state,
  l.state AS ledger_state, l.document_number
FROM public.physical_payment_intents i
LEFT JOIN public.payper_document_ledger l ON l.payment_id=i.payment_id
WHERE i.route='direct' AND (
  i.state IN ('uncertain','approved')
  OR (i.state='reserved' AND i.created_at < now()-interval '2 minutes')
  OR (i.state IN ('dispatching','pending') AND
      i.dispatch_started_at < now()-interval '6 minutes')
  OR (i.state='succeeded' AND l.state='source_blocked'))
ORDER BY i.created_at;
```

## Local verification

All provider calls in tests are mocked. `node --test server/pelecard-physical/*.test.js`, focused physical Vitest suites, `npm run test:full-schema`, and `npm run build` exercise this candidate. The full-schema rehearsal uses only synthetic rows and verifies a one-shot dispatch claim, immutable first response, existing-order finalization, and repeat-safe direct document association. No live Pelecard request, production migration, deployment, real invoice or ORD-1060 action has been made.
