# Payper provider response diagnostics: disabled release

Scope: the reviewed `202611030005_payper_provider_diagnostics.sql` migration and
`payper-issuance-worker` bundle from the same commit. The existing
`catalog_id: ""` correction is included. No Vercel application change is needed.
This release does not authorize a charge, invoice, retry, or financial activation.

## Prerequisites and deployment order

1. Record the current production Vercel deployment, Payper worker version,
   migration state, ledger state for RCP-1021, dispatch controls, Edge switch
   fingerprints, and recovery schedules. Require Payper dispatch, automatic
   wake/scan, email and payment recovery OFF; allowance zero; no recovery
   schedule. Stop on an unexpected change. Preserve the prior worker bundle.
2. Verify `202611030005` is unapplied and the old
   `record_payper_dispatch_outcome` RPC and `payper_document_ledger` exist.
   Apply **only** `202611030005_payper_provider_diagnostics.sql`. Do not run any
   historical migration, activation RPC, or backfill.
3. Verify the new diagnostics table has RLS and service role only read access;
   verify the new RPC is service role only. Confirm RCP-1021, the original
   Payper ledger, cutoff, target, allowance, document count, and cron state are
   unchanged.
4. Deploy **only** `payper-issuance-worker` from the reviewed commit. Keep all
   financial Edge switches OFF. Verify its version, deployment status, and
   disabled behavior without calling CreatePayperInvoice. No Vercel deployment
   or alias change is part of this release.
5. Recheck the controls and audit records in step 1. Preserve the new Edge ID,
   migration evidence, and previous worker version for recovery.

The provider's `StatusCode`, `PayperData.InvoiceStatus`, and
`PayperData.InvoiceError` are captured only after a future reserved request and
stored privately with the ledger outcome. The public accounting UI retains a
safe reason code. Do not print the private error in general logs or staff UI.

## Recovery

If a mandatory check fails, leave dispatch OFF. Restore the previous worker
bundle if the new bundle is defective. Leave the additive migration installed:
the old RPC still exists and no prior row is changed. Do not reverse a
financial ledger transition or retry a possibly sent invoice. Investigate
RCP-1021 with transaction-specific provider evidence under separate approval.

## Separate canary authorization

A new genuine payment requires its own approved amount, customer billing
identity and email, immutable future cutoff, one payment target, one document
allowance, and explicit authorization for the real charge, Invoice-Receipt and
email. Automatic worker wake and recovery must be live before the buyer pays.
Afterward, verify Payper's actual status/error (privately), saved number/link,
document content and delivery evidence; stop all temporary gates on any
ambiguous outcome. Continuous processing requires another approval after a
successful automatic canary.
