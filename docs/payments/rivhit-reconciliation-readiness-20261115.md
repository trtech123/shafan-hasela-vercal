# Rivhit reconciliation readiness — 15 November 2026

**Status:** read-only preparation. This branch adds no production migration, worker, posting, or dispatch switch. Preserve the existing paused plan in [rivhit-pause-handoff-20261115.md](./rivhit-pause-handoff-20261115.md). It is based on `plan/rivhit-sync-20261115` at `36d5bf9`; terminal 1 must reconcile it with later cashier/payment branches before any integration. The existing draft Rivhit migration is **not applied** and its migration version conflicts with another workstream's migration name.

## Source contracts and accounting boundary

| Source | Meaning | Reconciliation treatment |
| --- | --- | --- |
| `orders` | Scheduled service, amount and payment status | Operational obligation; do not post merely because an order exists or its status changes. |
| `payment_transactions` | Pelecard payment, refund, or void attempt, linked to order/sale; `verified_at` proves provider verification for successful payments | Compare verified success to the sale and official document. Failed, pending, ambiguous, and unverified attempts are exceptions, not revenue. Refund/void needs its own approved reversal treatment. |
| `sales` | POS sale and `RCP-*` internal confirmation, with final post-discount `total` and JSON discount | Match to payment/order. `RCP-*` is **not** an official tax document or a standalone journal instruction. |
| `payper_document_ledger` | Official Payper document status, number, URL, payment/sale/order links | A succeeded document is the accounting source candidate. `source_blocked` and `reconciliation_required` require evidence review; never issue a second invoice to fill a gap. |
| Billing and checkout snapshots | Frozen customer identity, VAT decision, items, quantity and discounts | Compare approved PDF lines, net, VAT, and gross. Do not derive VAT from payment method or a default. |
| `accounting_events` | Legacy Rivhit orchestration and reconciliation state | Existing seven events are held at `configuration_required` with `payper_transition_hold`; never release automatically. |
| Draft `rivhit_bookkeeping_*` | New disabled intake, immutable source and journal legs | Local planning only. No new intake or legs tables installed in production. |

Cash and check can have internal sales without a `payment_transactions` row in the older schema; their financial reality must be established from the applicable cashier ledger and official document. A sale method by itself is not proof of payment or issuance. Invoice-Receipt may create separate revenue/VAT and receipt journal legs, so two distinct journal IDs sharing a document reference are not automatically duplicates. No account code, debit/credit direction, VAT treatment, or journal date is selected here.

## Production read-only snapshot

The SQL files in `scripts/rivhit/` were run against project `divzxsynczeifkpnpupl` with Supabase CLI `db query --read-only` on 15 November 2026. They return counts or the three named historical references, not customer fields, card data, credentials, or document URLs. Counts are a point-in-time diagnostic, not an audited financial statement.

| Measure | Observed |
| --- | ---: |
| Orders / POS sales | 24 / 38 |
| Provider-verified successful payment operations | 9 |
| Verified successful payments without a Payper ledger row | 2 |
| Payper ledger: succeeded / reconciliation required / source blocked | 1 / 3 / 3 |
| Succeeded Payper rows without a verified payment / with payment-sale amount mismatch | 0 / 0 |
| Legacy accounting events at configuration required | 7 |
| New Rivhit bookkeeping intake/legs installed | no / no |

The two payments without a Payper ledger row are **review candidates**, not automatically missing invoices: their dates, eligibility, and prior accounting path must be checked. Sale methods observed include credit, Pelecard, cash, check, bank transfer, invoice, split, voucher/app variants; no mapping for these to Rivhit is assumed.

### Historical references

- **Official Payper 200002:** Production read-only join confirms a succeeded, provider-verified ₪4 ILS digital payment; POS sale `RCP-1026` for ₪4 on 8 November; and a succeeded Payper ledger entry with exact payment/sale linkage. The separately reviewed official Invoice-Receipt has ₪3.39 net and ₪0.61 VAT at 18%. The authorized Rivhit read probe previously found no exact reference in the responses it received, but the 9 November journal report failed three times (HTTP 502) and 12 of 26 candidate customer reports failed. Rivhit presence or absence is **undetermined**. Never post or issue another record for 200002 based on that incomplete search.
- **RCP-1039 / RCP-1043:** Production read-only query found ₪1 internal sale confirmations dated 15 November, with check and cash methods respectively, and no linked payment through `sales.payment_transaction_id`, Payper ledger state, or official document number in the queried records. These internal RCP numbers are not tax document numbers. Review the actual collection evidence and any non-card ledger/document separately before deciding whether any official document is missing. Do not auto-post either sale.

## Safe local comparison

`scripts/rivhit/reconcile-readonly.mjs` is a pure comparator. `run-reconciliation-readonly.mjs` accepts a minimal approved JSON projection through stdin and emits counts plus HMAC case references. It performs no DB/API call and does not emit source IDs, document numbers, customer fields, or URLs. Never commit a real input projection or HMAC salt. Use a new private salt for each controlled run, retained securely if the same case refs must be compared later.

Projection keys: `coverage` (`partial` unless **all** accountant-approved periods and account reports succeeded, then `complete`), `payments` (`id`, `operation`, `status`, `verified`, `amountMinor`, `currency`, `method`, `saleId`, `documentExpected`), `sales` (`id`, `receiptNumber`, `totalMinor`, `method`), `documents` (`id`, `paymentId`, `saleId`, `state`, `number`, `grossMinor`, `vatMinor`), and `rivhitRows` (`journalId`, `reference1`, `reference2`, `kind`, `amountMinor`, `vatMinor`). Values are integer agorot; `documentExpected` must be `yes` only after eligibility and activation ownership are established. Do not include names, emails, phone numbers, card fields, tokens, invoice URLs, or whole provider responses. `kind` is `invoice` or `receipt` only after journal semantics are confirmed by Anat. Multiple different journal IDs are not classified as duplicates; repeated journal IDs or multiple official documents are review flags, not proof of double posting.

Example local invocation after a secure, approved projection has been prepared (do not put the input file in Git):

```powershell
$env:RIVHIT_RECONCILIATION_SALT = '<private random value of at least 16 characters>'
Get-Content -Raw '<approved-local-projection.json>' | node scripts/rivhit/run-reconciliation-readonly.mjs
Remove-Item Env:RIVHIT_RECONCILIATION_SALT
```

`coverage=complete` is never inferred from a successful single report. A missing Rivhit reference under partial coverage is `rivhit_search_incomplete`, not a confirmed absent entry. This comparator is a triage aid; final accounting conclusions require PDF and Rivhit journal inspection by Anat.

## Exact read-only verification for 200002

1. In an authorized, ephemeral read-only session, verify Rivhit company identity and choose Anat's confirmed report, relevant accounts and posting period. Do not print the token.
2. Re-run `Accounting.JournalsReport` for every potentially relevant posting date, including 8–9 November 2026 and any later import date Anat identifies. Retry the prior failed 9 November read. Record report success/failure and search exact official number `200002`, internal sale `RCP-1026`, and the payment identifier supplied securely at runtime. Do not log that identifier.
3. Run `Customer.JournalReport` for **all** accountant-approved accounts and years/report options; repeat the 12 previously failed account reads. Search both reference fields and journal detail. A different date/account or an upstream Payper→Rivhit connector may explain a match.
4. For any candidate rows, match company, official document type/number, gross ₪4, VAT ₪0.61, period, payment method and distinct journal legs against the official Payper PDF. Record only aggregate result, HMAC case ref, journal identifiers in a restricted evidence store, and report coverage. Do not write a journal entry.
5. If coverage remains partial, classify as **unresolved**. If no match after complete approved coverage, ask Anat to verify in the Rivhit UI and upstream connector before authorizing any posting.

The Rivhit read APIs used in the prior probe are `Accounting.JournalsReport` and `Customer.JournalReport`; their date/account scopes and response references must be respected. This branch does not call `AddJournal`.

## Decisions required from Anat; then implementation

1. **Existing flow:** Do Payper documents already reach Rivhit through another connector? Identify connector, delay, matching reference and duplicates policy. Then mark already represented sources reconciled before enabling any new writer.
2. **Authoritative report and coverage:** Name exact report, company, date rule, accounts and expected journal legs for Invoice-Receipt, including whether a receipt leg has the same reference. Then finalize read-only extraction and coverage criteria; resolve 200002 and historical RCP cases.
3. **Mapping:** Approve sort code, revenue account by site/product, output VAT account, customer/clearing account and payment-method accounts for digital card, physical card, cash, check, transfer, split and voucher. Then freeze a versioned mapping with accountant approval, never infer from candidate codes.
4. **Journal semantics:** Approve debit/credit treatment, timing, gross/net/VAT split, discount treatment, rounding, settlement vs sale date, refund/void/cancellation and postdated-check timing. Then add exact fixtures and dry-run journal legs for approved types only.
5. **Exceptions and historical cutoff:** Decide which pre-activation transactions are already accounted for, which need manual correction, and which unsupported methods stay held. Then reconcile explicitly, never bulk replay the seven legacy events.
6. **Release controls:** After the above, terminal 1 resolves duplicate migration version/shared-file conflicts, rehearses a dedicated migration, obtains separate approval for migration and writes, and pilots one source with before/after Rivhit report comparison. Only then consider enabling intake and dispatch; ambiguous write responses remain held for read-only recovery.

No production action is authorized by this document. There is no evidence yet that **all** financial activity is reflected correctly in Rivhit.

## Local verification and limits

The six synthetic reconciliation tests pass. The existing focused Rivhit bookkeeping, intake and connection-check suites pass (31 tests across three files). The app production build passes. The repository-wide `npm run typecheck` fails on existing `node_modules/punycode` and unrelated JSX typing errors; the new scripts are outside its `jsconfig.json` include list and pass `node --check`. No live Rivhit read was repeated in this branch because the prior temporary read probe was removed and deploying a new probe is outside this workstream's authorization.
