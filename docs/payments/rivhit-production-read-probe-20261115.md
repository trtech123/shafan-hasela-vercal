# Rivhit Production read probe — 2026-11-15

## Scope and lifecycle

The only deployed artifact was the temporary `rivhit-connection-check` Edge Function in Supabase project `divzxsynczeifkpnpupl`. Its deployed setting was checked as `verify_jwt=true`. The function accepted service-role JWTs only, fixed read modes only, and used `RIVHIT_API_TOKEN` inside Edge. A bounded invocation script deleted it in `finally`; the subsequent function inventory reported `function_remaining=0`. A preflight also removed an earlier deployment immediately when the inventory parser failed to establish the JWT setting. No Rivhit write endpoint, payment, Payper issuance, migration, queue replay, or other function deployment was invoked.

## Verified results

* `Company.Details` succeeded using the existing token and identified **שפן הסלע מצוקי רמים בע״מ** (company ID checked; omitted from public summary). This establishes a working read connection and matching company name; Anat should confirm the legal entity if the name alone is insufficient.
* `Accounting.SortCodeList` succeeded and returned 79 codes. Narrow candidates for the pilot: `7` תשלום בכרטיס אשראי, `100` הכנסות/מכירות, `107` הכנסות פודטראק ברקו, `110` הכנסות מקופה רושמת. `150` הכנסות/מכירות-פטורות and `160` הכנסות פטורות מקופה רושמת are present, but tax treatment is unconfirmed. These are *sort codes*, not verified general-ledger account cards or an approved posting map.
* `Accounting.JournalsReport` succeeded for 2026-11-01 through 2026-11-08 and 2026-11-10 through 2026-11-15. The probe found zero rows with either reference field containing Payper document `200002` or payment ID `PRODUCTION_PAYMENT_ID_REDACTED` **and** total amount exactly 4.00. The 2026-11-09 report returned a server error and was not searched successfully. Other reference fields, aggregated postings, and periods outside the tested range remain unexcluded. Therefore absence from Rivhit is *not proven*.
* `Customer.List` exceeded the function's 2 MB response limit. No account cards were returned. This does not establish a permissions failure, and it does not verify that `Customer.List` is the complete chart of accounts. Direct report read permission was demonstrated by the journal calls; permission for every report type was not tested.
* The Production Payper issuance ledger records document number `200002`, succeeded state, amount 4.00 ILS, a `sale` source, payment creation on 2026-11-08 02:38 UTC and a sale date of 2026-11-08. Its item snapshot identifies one `טרופית` at 4.00. The exact Payper document issue timestamp and document type have not been read from the issued document.

## Local dry run, held for accounting approval

| Field | Proposed value | Evidence/status |
|---|---|---|
| External document reference | Payper `200002` | Verified in Production issuance ledger |
| Source payment identity | `PRODUCTION_PAYMENT_ID_REDACTED` | Verified in Production ledger |
| Gross amount and currency | 4.00 ILS | Verified in Production ledger |
| Source date | 2026-11-08 | Verified sale/payment date; accounting posting date requires approval |
| Item | טרופית, quantity 1 | Verified source snapshot |
| Revenue sort code | Candidates `100`, `107`, `110` | Read from Rivhit; choice requires Anat |
| Payment sort code | Candidate `7` if card payment | Read from Rivhit; actual tender and map require verification and Anat |
| VAT, debit/credit accounts, customer/clearing account | Unset | Account cards unavailable; Anat must approve |
| One or two journal legs, report and period | Unset | Anat must approve |

No `Accounting.AddJournal` payload was generated or transmitted. This table is a proposed mapping view only.

## Minimal decision request for Anat

1. Confirm that the legal entity named above is the intended bookkeeping company, and check whether document `200002` is already posted through another route. A journal report lookup did not establish global absence.
2. For the 4.00 ILS `טרופית` sale, choose the revenue sort code among `100`, `107`, and `110` (or specify another), and supply/approve the debit, credit, VAT, customer and card-clearing *account numbers*. Confirm whether code `7` applies to this payment after the tender is verified.
3. Confirm the issued Payper document's type, issue date, VAT breakdown, and payment method; then approve whether a single balanced journal or separate sale and settlement legs are required, the posting date/period, and the report in which one posting should appear.

Before any first write, resolve the 2026-11-09 report error or have Anat verify the document's absence using an authoritative Rivhit search/report. The separate bookkeeping queue remains disabled and no historical events were released.
