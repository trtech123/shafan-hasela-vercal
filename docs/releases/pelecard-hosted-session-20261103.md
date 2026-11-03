# Hosted POS session safety release

Source: this commit, based on the current POS/Orders/Payper production source. Deploy only `pelecard-pos-payment` and the Vercel app. No database migration, Payper worker update, or Orders checkout change is required.

## Before deployment

1. Record the active Vercel deployment and POS Edge version. Confirm Payper dispatch, automatic wake/scan/email, pending-payment recovery, and both recovery schedules are OFF. Keep the Supabase POS initiation gate OFF. Preserve all prior payment and accounting records.
2. Confirm the target source includes the reviewed `aae371d` POS recovery fix. Build from the repository root; the Vercel project Root Directory is `app`.
3. Deploy the POS Edge change while initiation is OFF. Build an unaliased Vercel candidate from this exact source and run authenticated Admin and Cashier non-charging checks for Cash Register, Orders and Accounting. Promote only that candidate after mandatory checks pass.

## Verify

- A saved `pending_provider` POS attempt shows status/verification, without a link that reopens its hosted page.
- Read-only transaction reconciliation never GETs a buyer PaymentGW page. Pelecard 301 closes the hosted link and keeps the charge outcome unknown until authoritative evidence resolves it.
- A new genuine purchase uses a fresh request key and one provider initialization. Preparing a cart does not open the hosted page. No checkout or invoice request is made during smoke tests.
- Reconfirm Payper and recovery controls remain OFF and historical obligations are unchanged.

## Recovery

If a safety check fails, keep or set Supabase POS initiation OFF and Payper/recovery controls OFF. Do not reverse database migrations or clear pending payments. Restore the previous POS Edge version and Vercel deployment with the gates OFF, then reconcile any in-flight session by its own identifiers before another attempt.

## Canary boundary

For a later separately authorized canary, complete all cutoff, target, billing, VAT, worker, schedule and gate checks **before** the buyer opens a newly initialized hosted session. Never use the hosted page as a readiness probe or reopen an expired link.
