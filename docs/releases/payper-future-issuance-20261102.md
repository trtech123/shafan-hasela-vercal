# Future Pelecard payments: disabled Payper repair release

This package is **not** authorization for a charge, tax document, production
deployment, credential change, or activation. Preserve RCP-1020 and payment
`28b4786f-e722-40ae-9661-f3e805fc71bf` in `source_blocked` for separate
manual accounting. Never rearm it during this release or include it in backfill.

## Confirm before a disabled deployment

Record the current Vercel deployment ID, four relevant Edge versions, installed
migrations, worker secret metadata, `payper_dispatch_control`, cron jobs, Vault
secret names, and the RCP-1020 ledger/document state. Verify POS initiation,
Payper dispatch, automatic wake, and scan are all OFF. Stop on a mismatch.
Keep the previous Vercel deployment and Edge snapshots for recovery.

## Exact reviewed release order, after separate deployment approval

1. Apply only new migrations `202611020003_payper_pre_dispatch_diagnostics.sql`
   and `202611020004_payper_future_activation_epoch.sql`, in order. Do not replay
   installed migrations. Verify the original cutoff, old canary ID, allowance,
   RCP-1020 ledger, and invoice counts did not change; `future_cutoff_utc` is
   NULL. The new admin epoch RPC is installed but not called.
2. Deploy the reviewed `payper-issuance-worker`, `pelecard-order-payment`, and
   `pelecard-pos-feedback` Edge bundles. The shared callback parser accepts the
   observed nested `ResultData` correlation but still requires authoritative
   provider lookup and validation. Keep every financial Edge switch OFF. While
   dispatch is OFF, call the worker once with its existing bearer token,
   `x-payper-mode: lookup-diagnostic`, and
   `x-payper-target-payment-id: 28b4786f-e722-40ae-9661-f3e805fc71bf`,
   with no body or a zero-byte body. Require `verified=true` and record ID
   `3175016155`. Non-empty JSON and all other payloads are rejected.
   This path reads the existing succeeded payment and calls only
   `GetTransaction`; it cannot reserve or create a document. Record only the
   sanitized response and stop the release on a mismatch or lookup error.
3. Deploy the matching Vercel application from the repository root to an
   unaliased preview (Vercel Root Directory is `app`). Check Admin and Cashier
   non-charging Orders, Cash Register, Accounting, Clubs, and WhatsApp flows.
   Promote only that exact preview if all checks pass. The accounting UI labels
   the Rivhit hold as the intentional duplicate-document fence and shows the
   Payper exception separately.
4. Recheck all disabled switches, old ledger/document counts, migration rows,
   Vercel ID, Edge versions, and cron job count. No payment or invoice request
   is part of the disabled deployment.

## External prerequisite before any activation

The owner updated the worker's three Pelecard secrets from the verified merchant
record. A single official read-only `GetTransaction` call using the same values
returned `StatusCode=000`, ₪3.00 ILS and record ID `3175016155`; the secret
store fingerprints matched those privately entered values. The deployed worker
itself still needs the read-only diagnostic above after this release is deployed.
Never print credentials or change payment evidence. Confirm the live terminal
has `CreatePayperInvoice` permission, documented
`send_by_mail` setting, verified billing email, worker token and Vault match,
and cron/pg_net access. No authoritative Payper absence lookup by
`trxRecordId` is implemented; uncertain invoice outcomes remain held for manual
reconciliation without retry.

## Fresh future-only canary, separately approved

1. Verify a genuine item, VAT-inclusive total, real legal billing identity,
   description, and email in the application. Check no document already exists
   for the selected new payment. Obtain approval for the specific real charge
   and one Invoice-Receipt. Keep RCP-1020 held.
2. In a supervised window, configure secure worker authentication and Vault;
   install the existing `scripts/payments/install-payper-recovery.sql` schedule
   only under activation approval. Enable the POS initiation gate only for the
   checkout window. Enable worker dispatch and auto wake; enable scan only when
   its schedule is ready. Call `activate_payper_future_canary(admin_uuid)` once
   from a trusted service-role session. It records a new immutable UTC cutoff
   and archives the old cutoff/target without changing them. No invoice can be
   reserved until a new payment ID is targeted.
3. Reserve a **new** checkout intent without card entry. Verify server amount,
   source, billing snapshot and description, then call
   `target_payper_canary(admin_uuid,payment_uuid)`. Confirm database target,
   cutoff and allowance 1. Only this post-cutoff payment can reserve an invoice;
   historical and unrelated rows are excluded both from the scan and atomic
   dispatch reservation.
4. The owner completes the hosted card payment. Provider verification finalizes
   the sale and creates the durable ledger row; the finalizer wakes Payper.
   The scheduled scan recovers a missed wake without processing a held or
   uncertain row. Do not invoke the worker manually as the success path.
5. Verify provider payment, exactly one sale, one ledger outcome, invoice
   number/link and document contents in Admin Accounting, and provider/mailbox
   evidence of email delivery. If anything is uncertain, stop dispatch and
   reconcile manually. Never retry a possible invoice request blindly.

## Continuous mode and emergency stop

Only after a successful canary document and separate approval, inspect all
pending/held exceptions and call `enable_payper_continuous(admin_uuid)` from a
trusted service-role session. It requires the new canary's saved number and
URL. Keep wake and scheduled scan active. Monitor queue age, source blocks,
uncertain outcomes, missing ledger rows, worker errors, and cron/net failures.
Each new verified payment has its own one-shot atomic reservation; there is
no arbitrary global document quota in continuous mode.

For emergency shutdown, set `PAYPER_DISPATCH_ENABLED=false` first, call
`stop_payper_dispatch(admin_uuid)`, disable auto wake and scan, unschedule
`payper-eligible-recovery` if needed, and close POS initiation when checkout
itself must stop. Verify all switches and ledger states. Roll back Vercel and
Edge code to saved versions if needed; leave migrations and audit evidence in
place. A reserved/uncertain invoice remains a manual reconciliation case.
