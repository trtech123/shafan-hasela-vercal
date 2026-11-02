# Cash Register Pelecard: disabled release package

## Source and migration provenance

- The POS implementation starts at `dc8e704`; `83ff64c` adds the PostgreSQL fix, POS Rivhit fence, regression assertions, and this release procedure. The automatic Payper wake is based on existing local commit `89475ab` and extends its gated post-verification wake to POS sales.
- Migrations `032`–`042` are exact blobs from historical commit `322c8f8`. They restore the prerequisite schema chain to this isolated branch. They are dependencies for a clean-room rehearsal, **not** a request to replay them in production.
- Main-worktree files `043_pelecard_document_observations.sql` and `046_chatbot_document_delivery.sql` are untracked local preparations. `044`–`045` are historical Git files unrelated to POS. None is imported into this release. The local `046_chatbot_document_delivery.sql` also conflicts in number with historical `046_quotation_lifecycle.sql`; neither is part of the POS deployment.
- The **only new production migration** in this package is `202611020001_pos_pelecard_intents.sql`. Check the production migration registry and schema before applying it once. Never replay installed migrations `032`–`042`.

## Disabled deployment order

1. Read and record the current production Vercel deployment ID, existing Pelecard Edge versions, installed migration list, and Payper controls. Compare schema prerequisites (`pelecard_live_attempts`, `customer_snapshots`, Payper ledger and dispatch control) with the migration. Stop on any mismatch.
2. Confirm `PELECARD_POS_PAYMENTS_ENABLED=false` in the Supabase Edge and Vercel environments. Keep `PAYPER_DISPATCH_ENABLED=false`, `PAYPER_AUTO_WAKE_ENABLED=false`, `PAYPER_AUTO_SCAN_ENABLED=false`, cutoff `NULL`, allowance `0`, and automatic schedule absent. Preserve all existing Pelecard and Payper secrets without printing or rotating them.
3. Apply **only** `202611020001_pos_pelecard_intents.sql` to production, in a controlled migration transaction. Inspect the resulting private table, RPC grants, triggers, and unchanged dispatch controls. Do not use the disposable test fixtures in production.
4. Deploy `pelecard-pos-payment` and `pelecard-pos-feedback` with `verify_jwt=false` as configured; the payment handler validates the caller's JWT and Admin/Cashier role. Deploy the reviewed `pelecard-order-payment` and `payper-issuance-worker` revisions with automatic wake and scan flags off. Verify OPTIONS, route presence, and that POS preparation and initialization reject while the POS gate is off. Verify the worker rejects automatic mode while disabled.
5. Deploy the Vercel application and `/api/pelecard-pos` adapter from this reviewed branch as a preview first. Verify the preview is READY and that its build files match the commit. Promote only that exact approved deployment after the initial disabled gates pass.
6. Run non-charging Admin and Cashier Chrome checks in isolated sessions: product and service selection, linked-order routing, billing review, server gate rejection, accounting visibility, restricted Admin access, and existing cash/manual methods. Do not submit an initialization, card charge, invoice, or worker request.
7. Recheck Vercel deployment ID, Payper controls, POS and automatic gates, ledger state, and production routes. Record the observed values in the release log.

## Later supervised test and automatic activation

After a genuine catalog sale, valid legal billing identity, verified VAT-inclusive price, and separate financial authorization, enable one POS payment under supervision. Confirm the provider transaction and durable paid sale before authorizing a single targeted Payper worker invocation. Set a new prospective UTC cutoff and one-document allowance only for that approved invoice. Confirm Payper document number, link, issue date, amount, description, VAT, customer identity, and configured email behavior; disable dispatch immediately afterward. Hold any uncertain provider result for manual reconciliation without retry. Only after that test passes, separately approve automatic wake/scan configuration and monitoring. Do not process historical payments.

## Recovery

- If the disabled rollout fails, keep POS initiation off, reconcile any prepared or uncertain POS intents, and restore the prior Vercel deployment. The additive POS migration and inert Edge routes can remain installed. Do not blindly reverse database migrations or delete payment records.
- If any initialization is ever uncertain, do not create another attempt. Investigate the stored intent and Pelecard provider records manually before further action.
- If Payper issuance is ever uncertain, hold the ledger for manual reconciliation; never automatically retry a document POST.

## Separate first-real-test authorization

The initial real test requires a genuine active catalog product or service priced at exactly ₪1.00 VAT-inclusive, verified legal billing identity entered through the app, an approved service description, and confirmation that the terminal accepts ₪1.00. Enabling POS initiation, charging the card, setting a prospective Payper cutoff and one-document allowance, invoking the worker once, optional email, and automatic issuance each require their own explicit authorization. This disabled release performs none of them.
