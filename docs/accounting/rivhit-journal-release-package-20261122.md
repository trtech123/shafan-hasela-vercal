# Payper → Rivhit journal release package

This candidate is based on Production application source `78eb232475c3875e8cc56a89fd110554c7dfaca0`. Production alias was rechecked against READY deployment `dpl_7Cf8KjkJpXULrHpVtazjB4ZVCSqm`. No journal migration or function has been deployed.

## Exact inactive preparation release

1. Apply only `supabase/migrations/202611220001_rivhit_journal_outbox_disabled.sql` after normal backup and schema preflight. Its SQL checks force both `capture_enabled` and `posting_enabled` to `false`; it creates no historical queue rows.
2. Deploy `rivhit-journal-readonly` and `rivhit-journal-worker` with JWT gateway verification enabled. The read-only function allows an authenticated Admin to call only `Accounting.SortCodeList` and `Accounting.JournalsReport`. The worker requires the service-role JWT and remains disabled by absent `RIVHIT_JOURNAL_INGESTION_ENABLED` and `RIVHIT_JOURNAL_POSTING_ENABLED` flags.
3. Deploy the matching Vercel application with `/api/rivhit-journal-cron`. Its cron route requires the existing `CRON_SECRET`, a server-only legacy JWT in `SUPABASE_EDGE_SERVICE_ROLE_JWT`, and `RIVHIT_JOURNAL_CRON_ENABLED=true`. Leave that flag absent during preparation. The endpoint sends no provider request while disabled. Verify the Admin status screen shows both gates off.
4. Test the authenticated read-only Edge operations against the actual Rivhit account. Confirm the exact date format, journal report visibility and sort-code response before any activation. Do not log the token or raw responses.

No real read-only Rivhit API result has been confirmed from this candidate. The existing secret is confined to Supabase Edge, and the existing deployed Rivhit function performs writes. The new read-only function must first be authorized and deployed before a safe live `SortCodeList` / `JournalsReport` probe is possible. A logged-in desktop UI session does not prove the API contract.

Rollback of the inactive application is an ordinary Vercel alias rollback; revert the two Edge functions to their prior versions or remove the new functions. Leave the additive database objects in place with hard-disabled checks. Never restore the entire Production database merely to remove these objects.

## One approval table for Anat

| Future source | Recommended posting rule to approve | Exact values Anat must approve | Evidence |
| --- | --- | --- | --- |
| Pelecard Hosted / CT20, order or POS | One gross journal only after verified payment, sale and final automatic Payper document; reference 1 = Payper document number, reference 2 = `RCP-*`; capture date in Israel | Debit clearing account, credit income/receivable account, Rivhit sort code, VAT rate and optional project for each site | Frozen payment and billing evidence, Payper ledger and sale. No provider-side journal proof yet. |
| Cash, order or POS | Same future-only fence, with corroborated noncard payment | Debit cash account, credit account, sort code, VAT treatment and project per site | `payper_noncard_payments` plus final Payper ledger. |
| Cheque, order or POS | Record only the approved received/cleared stage; no implicit bank clearance | Debit cheque/receivable account, credit account, sort code, VAT and date rule | Noncard clearance status and document type are available; recognition timing is a business decision. |
| Partial, split, advance, refund, void or mixed tax | Excluded from this one-line gross mapping until separate rules prevent duplicate income/VAT | Receivable/advance/reversal accounts, document links, sign and tax allocation | Current one-line source gate requires full payment = sale total; no approved reversal mapping. |
| All methods and sites | Future cutover only; no automatic backfill | Exact mapping fingerprint, cutoff instant, manual-entry freeze and controlled first-entry approval | Outbox uniqueness, one durable reservation and readback protect against retries; historical 200002 is unresolved. |

The mapping JSON has no production default. Each provider/site rule must use positive account IDs and an approved VAT rate. The mapper derives a SHA-256 mapping fingerprint for each provider/site pair; the separate activation migration must insert each exact fingerprint into `rivhit_journal_approved_mappings`. A changed mapping cannot silently reuse an approved version. VAT is calculated from the approved inclusive rate and compared with Rivhit readback; a mismatch remains for reconciliation.

## Activation remains a separate release

After Anat approves the table, confirm the read-only API contract, stop overlapping manual entries at the agreed cutoff, and review all unmapped/uncertain records. The approved activation migration may then remove the hard-disabled checks, insert the approved provider/site fingerprints and set a **future** cutoff. Configure the server-only Vercel JWT and the three disabled-by-default flags deliberately. Authorize one real journal test separately; verify its returned year/month/line and exact `JournalsReport` row before enabling ongoing posting. An uncertain result is never resubmitted automatically. Payper document 200002 is historical and excluded.
