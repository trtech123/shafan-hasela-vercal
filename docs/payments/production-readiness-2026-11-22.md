# Production payment readiness audit — 22 November 2026

## Scope and source

Read-only production inspection and synthetic tests only. No payment, invoice, refund,
provider request, database mutation, gate change, or deployment was performed.
The live Vercel alias `shafan-hasela-vercal.vercel.app` resolves to READY deployment
`dpl_7Cf8KjkJpXULrHpVtazjB4ZVCSqm`. Its payment source files were checked against
deployed source `78eb232475c3875e8cc56a89fd110554c7dfaca0` in the preceding
audit. The present worktree starts from that source.

Database observations below are a point-in-time snapshot. `succeeded` in the local
payment table is not a fresh provider inquiry; `payper_document_ledger.succeeded`
is not proof of email delivery or Rivhit synchronization.

## Six Payper exceptions

Every row below has one `pelecard/succeeded` ILS payment with a provider session,
approval ID, verified timestamp, and one sale linked by payment ID. All are POS
transactions without an order. None has a saved official Payper number or URL.
The existing future-only invoicing policy forbids automatic retroactive issuance.

| Sale | Amount | Current ledger | Stored provider evidence | Safe disposition |
| --- | ---: | --- | --- | --- |
| RCP-1020 | ₪3.00 | `source_blocked / pre_dispatch_review_required` | No document dispatch reservation or provider record saved in the ledger. Earlier audit documented a failed credential check, not a Payper invoice request. | Confirm absence of an external document from Payper before accountant-led historical resolution. No automatic rearm. |
| RCP-1021 | ₪4.00 | `reconciliation_required / provider_document_rejected` | Pelecard record `3176264291`; no saved Payper response diagnostic. | Obtain the transaction-specific Payper result and search official documents before any accounting decision. |
| RCP-1022 | ₪3.00 | `reconciliation_required / provider_document_rejected` | Pelecard record `3176648579`; stored Payper response has provider status `000` and invoice status `Unauthorized credentials`. | Confirm whether Payper created any document despite the rejection; fix credentials only through separate controlled configuration approval. |
| RCP-1023 | ₪3.00 | `reconciliation_required / provider_response_uncertain` | Pelecard record `3182043940`; a response was received with provider status `599` and an invoice-creation/settings error. | Treat document outcome as uncertain until Payper portal/support confirms the exact document identity or absence. Do not resend. |
| RCP-1024 | ₪0.15 | `source_blocked / manual_accounting_hold` | Immutable `accountant_managed` hold recorded. | Keep the hold; Anat decides historical accounting treatment. |
| RCP-1025 | ₪0.55 | `source_blocked / manual_accounting_hold` | Immutable `accountant_managed` hold recorded. | Keep the hold; Anat decides historical accounting treatment. |

The local payment and sale result is established for all six. Fresh Pelecard
settlement, external Payper document existence, and email delivery remain
unverified unless stated in transaction-specific evidence. No duplicate
document should be inferred or created from a missing local number.

## Pelecard uncertain attempts

Production contains eight POS `pending_provider` payment rows with a provider
session but no local provider transaction ID, verified result, sale, or Payper
document, plus two `initiated` rows without a provider session. The Admin
accounting screen displayed three actionable Pelecard recovery alerts in the
previous live UI inspection. The protected `pelecard_pending_recovery_jobs`
table deliberately denies `service_role` SELECT. Its Admin-only
`list_pelecard_pending_alerts()` requires an authenticated Admin JWT; neither
the service key nor payment-row timestamps safely identifies which three are
currently alerted. Do not guess their IDs from creation order or bypass the
guard. Each alert needs an Admin-authorized read-only RPC result followed by
transaction-specific Pelecard lookup, including session correlation, amount,
currency, status, sale and document absence/presence. No repeat initiation.

The full conservative set of POS rows to account for is:

- `pending_provider`: `68a78d1c`, `2f937a41`, `0d246cab`, `f4cad285`,
  `222cda88`, `f7757a18`, `9d6c8334`, `8bed73d2` (UUID prefixes).
- `initiated` without a session: `a1abafa7`, `2a5ebe1a` (UUID prefixes).

All ten have no local sale. Their real provider outcomes are not proven by the
absence of local sale or by elapsed time.

## Method matrix

| Method and context | Production evidence | Readiness |
| --- | --- | --- |
| Hosted Pelecard, order | ORD-1058 → RCP-1044 → Payper 200003. Earlier ORD-1039 and ORD-1047 have linked sales but no Payper ledger. | Working, incomplete delivery and historical document proof. |
| Hosted Pelecard, POS | RCP-1026 → Payper 200002; six older successful payments remain in the Payper exception queue. | NO-GO for routine unmonitored operation until exception review and fresh controlled acceptance. |
| Direct J4 / CT20, order | ORD-1062 → RCP-1048 → Payper 200006. First response is durable. Deployed provider code uses ParamX → UID → GetTransDetailsEMV and checks register, merchant terminal and amount. | One successful historical transaction; post-fix live acceptance and email delivery still missing. |
| Direct J4 / CT20, POS | Synthetic tests only. | Live acceptance required. |
| Cash, order | ORD-1059 and ORD-1061 each have a successful payment, sale and Payper document. | Working; user-role and delivery coverage still incomplete. |
| Cash, POS | Legacy sale rows exist; current path uses `payper-noncard-collection`. | Current path lacks a complete live POS acceptance record. |
| Cheque, order/POS | Legacy sale rows exist; no live `payper_noncard_payments/check` result. | Live acceptance and accounting confirmation required. |
| External card, bank transfer, Bit/Paybox, deferred, split | The POS legacy handler writes a sale directly for these choices. It does not verify the external payment or automatically create/link a Payper document. | Recording workflows only; business and accounting rules required before calling them complete payment workflows. |

The legacy manual handler is in `app/src/pages/CashRegister.jsx`; the payment
choices are in `app/src/components/cashregister/PaymentScreen.jsx`. Existing-order
collection exposes cash, cheque, hosted digital, and physical payment. Hosted
digital is restricted to orders with zero amount previously paid. The balance
view blocks collection on fully paid or unresolved orders, while cash/cheque
and physical may collect the verified remaining balance.

The CT20 role policy allowing every authenticated application profile was
deliberately introduced by migration `202611170001_physical_all_authenticated_roles.sql`.
Other collection methods remain limited to Admin/Cashier. Management should
confirm that instructor and operations roles may initiate physical collection
before routine use. This audit did not change that policy.

## Accounting and operational gates

`payper_dispatch_control` currently reports `enabled=true`,
`dispatch_mode=continuous`, `dispatch_remaining=0`, and immutable future cutoff
`2026-11-03T02:19:21.709152+02:00`. It does not authorize historical replay.
Five Payper ledger rows are `succeeded`. Local `accounting_documents` has zero
rows; a Payper number must not be described as a completed Rivhit sync.
The app records Payper `send_by_mail` intent but has no Payper delivery receipt
table or webhook proving mailbox receipt. Provider/mailbox evidence is required.
Supabase REST served the authorized GET queries during this audit; the earlier
dashboard inspection showed a quota grace-period warning. Remaining capacity
and billing health require an account-level check before sustained operation.

## Decisions

Anat must approve the accounting event and document type for external card,
bank transfer, Bit/Paybox, cheque, deferred and split sales; the evidence and
operator required to mark an external payment received; the historical
treatment of RCP-1020–1025 under the future-only policy; and the boundary
between Payper issuance and a separately verified Rivhit synchronization.

Nurit/management must confirm which staff roles may initiate CT20 payment,
which manual choices remain visible before their accounting flow is defined,
and the cashier procedure for checking uncertain results without a second
charge or invoice.

## Controlled acceptance, requiring separate authorization

Use dedicated synthetic orders, products, and approved test billing contact.
For each method, record the actor role, unique intent/request key, amount,
provider correlation, sale, official document identity, document link,
delivery evidence, order balance, and accounting report. Do one transaction
at a time; reconcile uncertain results before any further attempt. Suggested
minimum is ₪1 per card/cash route only if the provider and accounting rules
allow it; cheque and external methods need Anat's document/recognition rule
first. Separate approvals are required for the actual charge or tender,
official document, email, refund, and any production release.

1. Hosted order and POS: separately authorized small transactions, one as
   Admin and one as Cashier; verify decline and timeout using synthetic/mock
   requests, not a second live uncertain charge.
2. CT20 order and POS: first verify register lock, merchant settings and
   ParamX/UID lookup readiness; then one controlled charge per context only
   after provider and merchant approval. Verify first J4 response and Payper
   document before any other CT20 test.
3. Cash order and POS: separately authorized tender and official document;
   verify the remaining-balance and fully-paid guards.
4. Cheque order and POS: use an approved cheque scenario only after Anat defines
   recognition, mandatory cheque fields, document type, and reversal process.
5. External card, transfer, Bit/Paybox, deferred and split: first approve
   evidence and accounting rules, then verify each processing or recording
   workflow without inventing provider approval.

Rollback of a code release must never delete or reverse a financial row. A
provider-uncertain case is held for reconciliation; refund, void, credit or
accounting correction needs its own authorized and audited procedure.

## Verification performed

- Focused app payment/UI tests: 382 passed across 36 files.
- Physical server tests: 66 passed.
- Payper provider/noncard tests: 27 passed.
- Full-schema rehearsal: 104 migrations, 85 tables, 306 functions, 141 policies,
  130 triggers, 1257 constraints, zero unvalidated; synthetic digital, cash,
  physical-balance, hosted-document and J4-first-response scenarios passed.

These tests prove local behavior, not every live provider or delivery outcome.
