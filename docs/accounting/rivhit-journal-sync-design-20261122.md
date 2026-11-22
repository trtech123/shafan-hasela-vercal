# Rivhit journal synchronization — mapping review, 22 November 2026

Status: **isolated implementation prepared; no migration deployed and no journal posting enabled**. Accounting mappings and posting rules require Anat and management approval. This branch starts from the deployed application source `78eb232475c3875e8cc56a89fd110554c7dfaca0`. The payment exception investigation remains on `codex/payment-readiness-20261122`.

## Read-only account evidence and implementation state

On 22 November 2026 the logged-in Rivhit desktop account was inspected directly. The sales-document report returned 41 pages for the broad 2026 range, and the journal-entry screen displayed existing November 2026 entries with debit/credit accounts, sort codes, reference fields, gross and VAT amounts. A general-ledger report did not provide a usable document search. The available UI did not establish whether Payper 200002 / RCP-1026 was posted under a different date or reference. Its status is **INCONCLUSIVE**, not absent. The API token was not accessible in the authorized execution context, so `Accounting.JournalsReport` and `Accounting.SortCodeList` could not be called on the live account. No records were changed.

The isolated candidate adds `Accounting.AddJournal`, `Accounting.JournalsReport` and read-only `Accounting.SortCodeList` adapters, a one-dispatch coordinator, service-role-only outbox transitions, a private journal worker and Admin read-only monitoring. The additive SQL migration has hard `capture_enabled = false` and `posting_enabled = false` constraints; a separate approved migration is required to remove those constraints and choose a future cutover. The Edge worker also requires a separate environment activation flag. No schedule or live posting is configured. The source validator supports successful Pelecard and corroborated cash/check documents, but tax split, recognition timing, refunds, mixed sites and partial-payment accounting remain unmapped until authoritative Payper facts and Anat's rules are available. The proposed table/RPC design is not approval to activate it.

## Existing implementation and boundary

- Before this candidate, `supabase/functions/_shared/rivhit/client.ts` implemented only `Customer.Get`, `Customer.New` and `Document.New`; the candidate adds separate journal posting and readback methods.
- `supabase/functions/rivhit-accounting/index.ts` is a standalone document endpoint. It says no payment provider invokes it in this phase. `supabase/migrations/022_rivhit_accounting.sql` has customer and document claim tables, not a journal table. Migration `027_payment_accounting_orchestration.sql` also creates `accounting_events` for verified Pelecard payments; `payment-accounting-worker` consumes them through `Document.New`, **not** `Accounting.AddJournal`. Its lease/retry semantics must not be reused for uncertain journal writes without a new dispatch fence.
- Current payments issue official documents through Payper. A successful Payper document or local `RCP-*` receipt is **not** proof of a Rivhit journal entry. The prior read-only audit found five successful Payper ledgers and zero rows in `accounting_documents`; the latter table is not a journal inventory.
- Six older Payper exceptions remain separate. Future-only invoicing and their manual holds must not be bypassed by a journal worker.

## Rivhit API contract to implement after mapping approval

The official `Accounting.AddJournal` JSON request accepts `api_token`, `sort_code`, `customer_id_debit`, optional `customer_id_credit`, `amount`, `year`, `month`, `reference_date`, `due_date`, `reference1`, `reference2`, `details`, `currency_id`, `foreign_amount`, `exchange_rate`, `project_id`, `id_number`, `request_reference` and `shaam_invoice`. Its success response carries `data.year`, `data.month` and `data.line`. The API schema alone does not establish that `request_reference` prevents duplicate journal writes. Confirm that contract with Rivhit before relying on it.

`Accounting.JournalsReport` accepts a date and returns entries with `journal_id`, year/month, debit/credit account IDs, sort code, references, dates, amount, VAT and amount before VAT. `Status.LastRequest/{FORMAT}` accepts a request reference and returns a generic response string. Confirm search range, retention, visibility, uniqueness and the relationship of `AddJournal.data.line` to report `journal_id` with Rivhit. A report match by amount alone is not sufficient evidence.

Official references: [AddJournal](https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/help/operations/AddJournal), [JournalsReport](https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/help/operations/JournalsReport), [LastRequest](https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/help/operations/LastResponse), [SortCodeList](https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/help/operations/SortCodeList).

## Posting design

1. Define a source event only after an authoritative settled payment and its applicable official Payper document have been linked. This is an eligibility fence, **not** yet an accounting recognition rule: Anat must choose whether revenue is posted from the document, payment, or another event. Do not double-post revenue when a partial payment clears an existing receivable.
2. Start with a forward-only activation instant after a reconciled inventory of existing manual Rivhit journals. Older source events remain `manual_or_historical` and are never silently backfilled. The inventory must include manually posted entries, their references and the corresponding Shafan/Payper IDs; ambiguous matches require Anat's decision.
3. Store an immutable source snapshot and approved mapping version. Proposed unique key: `(rivhit_account_namespace, source_system, source_id, journal_kind)`. A revision to a mapping must not repost an already posted event. Derive one stable request reference from that key; save a payload hash before dispatch. Any payload change for the same key blocks dispatch.
4. Use a private journal outbox, restricted to a server worker. Atomic claim and one durable dispatch reservation precede the HTTP request. Keep the provider response, HTTP status, year/month/line, request reference, payload hash and timestamps. Suggested states: `blocked_mapping`, `ready`, `reserved`, `submitted_unverified`, `verified`, `definitive_rejection`, `manual_review`, `manual_existing`. Only `ready` may dispatch. Never automatically repeat a reserved or uncertain write.
5. After a successful response, read back the journal and compare reference(s), date, account IDs, sort code, amount, currency and VAT treatment. If response or readback is missing/ambiguous, check `Status.LastRequest` and date-scoped report, then hold for human reconciliation. Do not interpret a timeout or empty search as proof that no journal was posted.
6. Restrict posting to explicitly enabled future events and approved sort codes/accounts/projects. Add monitoring for outbox age, uncertain writes, report mismatch, closed month and auth failures. Keep provider tokens server-only. Admin can see status; no cashier/client write access to journal state.

## Questions for Anat and management

The accompanying worksheet contains one row per scenario, with unapproved values clearly blank. Obtain:

1. A sample of an actual manually entered Rivhit journal for each business scenario, with sensitive customer data removed; the business account namespace and active chart of accounts.
2. The source that recognizes income (Payper tax document, receipt/payment, or order fulfillment), its timing and whether Payper or any other feed already creates Rivhit entries. Specify the rule that avoids duplicate revenue and duplicate VAT when payment and invoice occur at different times.
3. For each payment method and sale category: Rivhit `sort_code`, debit account, credit account, settlement/clearing account, income account, VAT account and tax treatment. Explain whether Rivhit sort code automatically splits VAT or whether separate lines are required.
4. The mapping from Shafan activity/site/product to Rivhit `project_id`, income account and VAT rate/exemption. State the effective date for rule changes and handling of mixed-rate orders.
5. For partial, split, deferred and advance payments: which event posts which amount, receivable/advance account, closing entry and reference to the original Payper document.
6. For refunds, voids and credit documents: the approved reversal/storno process, sign conventions, original-entry linkage and whether the Rivhit API permits the required format. No negative amount assumption.
7. Which date is the journal reference date, which period is posted, what happens in a closed month, required reference number fields and currency/FX policy.
8. The cutover instant and a read-only export of already posted manual entries for that interval, with a unique document/payment reference. Anat must sign off ambiguous or missing references before activation.
9. Whether `request_reference` is provider-enforced idempotency for `Accounting.AddJournal`, and whether `LastRequest` plus `JournalsReport` can prove an uncertain outcome. Rivhit support may need to answer these API questions.

## Implementation sequence after approval

Approve mapping worksheet and inventory; confirm Rivhit API readback/idempotency; add a journal-specific migration and mocked contract tests; run dry-run comparison with new eligible events; review zero ambiguities; enable a one-entry controlled live acceptance under separate authorization; verify report match and accounting approval; only then enable monitored future automation. No historical backfill is in scope.
