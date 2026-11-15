# Terminal 1 handoff: cash schedule collection

Source: `feature/payper-check-payments` at `bc285fd7bf19a9cf68f2e3fbd557786e07e91c1e` plus the provider-mocked cash rehearsal committed with this note. Production audit was read-only through Supabase CLI `db query --remote=divzxsynczeifkpnpupl --read-only` on 2026-11-15. The server identified itself as PostgreSQL 17.6 and the role as `supabase_read_only_user`. No payment, document, migration or deployment was performed.

## Actual production schema

- `supabase_migrations` schema and `schema_migrations` table are absent. This project has no authoritative SQL migration ledger. Infer installed migrations from catalog markers and the historical release record; do not create or repair a migration ledger.
- Production has 81 public tables, 272 public functions, 140 public RLS policies, 126 noninternal public triggers, and 601 public constraints, all validated. The isolated application replay had 66 tables, 248 functions, 125 policies and 120 triggers before adding terminal migration `202611150002`. Constraint counts across PostgreSQL 17 and PGlite are not a useful equality check.
- The isolated replay has `payper_noncard_payments`, absent in production. Production has 15 tables absent from that replay: `bot_club_registration_links`, `club_attendance_audit`, `club_session_audit`, `club_session_roster`, `instructor_user_link_audit`, `instructor_user_links`, `order_confirmation_revisions`, `order_confirmation_signature_claims`, `order_delivery_attempts`, `order_form_save_requests`, `order_signature_deliveries`, `order_signature_rate_limits`, `quotation_delivery_attempts`, `quotation_revisions`, `quotation_save_requests`.
- Production has the required core columns on `orders`, `sales`, `payment_transactions`, `payper_document_ledger`, `accounting_events` and `physical_payment_intents`. The named pre-migration constraints `payment_transactions_provider_check`, `payment_transactions_checkout_snapshot_check`, `payper_reserved_requires_trx_record`, `orders_payment_status_check` and index `payper_document_ledger_order_unique` exist with the expected old definitions. The payment amount, idempotency and physical unresolved-register indexes exist. The existing checkout snapshot validator, order reserve/finalize, Payper outcome and physical finalize functions resolve; relevant service grants are present. RLS is enabled on the core tables; physical intents have forced RLS. Their expected order/payment/sale protection triggers are enabled.
- `payper_noncard_payments`, `record_payper_order_collection`, `get_payper_order_collection`, `reserve_physical_order_payment`, `guard_hosted_after_noncard_partial` and `physical_order_source_is_safe` are absent, as expected before the coordinated release.
- Production has the extra enabled `guard_order_quotation_snapshot` trigger on orders. Its definition preserves an unchanged quotation link during a normal payment-status update, but it was absent from the isolated replay. Production has other quotation/signature/attendance additions. These are real schema drift relative to the branch, so the integrated release must include current `main` before production rollout.
- A further isolated replay combined this branch's 67 migrations, the 18 `main`-only migrations, terminal 1's latest 002, and two production-only migrations recovered from Git history: `202610250001_club_chatbot_registration_links.sql` (`f9d4931`) and `202611080002_payper_confirm_automatic_document.sql` (`42d455b`). It passed the cash and physical collection checks. Its public table names differed from production only by the planned `payper_noncard_payments` table; RLS policy names matched exactly; trigger names differed only by the planned `payment_transactions.guard_hosted_after_noncard_partial`. The source bodies of the existing checkout validator, Payper outcome, hosted reserve/finalize, customer snapshot and check-register guards matched production after whitespace normalization. The physical finalize body intentionally differs because 002 replaces it.
- Two production chatbot functions remain outside that combined source: `prepare_bot_whatsapp_inbound(...)` (from `d2b491c`) and `cancel_pending_bot_handoff_for_menu(...)` (from `d8c919e`). They do not participate in collection, but terminal 1 must preserve them when reconciling the current production source. The two additional production-only migrations above also must be retained; neither appears on current `main` or the integration branch.
- Remote integration branch `integration/physical-schedule-collection-20261115` at `d6bdcf4152c1b1facbf2856be321783e7c930751` contains checkpoint `bc285fd`, but is **not** descended from current `main` `086da7f914f0a33d22941e82ea27000a84f24e23`. It lacks 18 migration files present on `main` (044–050 plus attendance, chatbot, signature and delivery migrations). Reconcile these source files with production markers and merge the current production source before release. Do not replay already applied migrations merely because they are absent from the old branch.

## Required integrated order

1. Reconcile current production `main`, its 18 additional migration files, the two production-only migrations and two chatbot functions above with the integrated branch. Compare live catalog markers for each; the production migration ledger cannot supply this history.
2. Apply `202611150001_payper_check_payments.sql` from the check/cash branch. It adds the non-card payment table and RPCs, drops the one-document-per-order index, extends provider/payment-status constraints, and creates a durable Payper obligation after received cash or check.
3. Apply terminal 1's `202611150002_physical_order_collection.sql`. Its order reserve RPC depends on the non-card migration's shared order-balance semantics.
4. Apply `202611150003_physical_order_collection_compat.sql`. It accepts a strictly validated physical `source_order` snapshot and permits a physical remaining-balance reservation after historical non-card payment while retaining the hosted digital overcharge guard. This branch's function now uses the same exact payment-ID, order-ID and amount correlation as terminal 1's latest integrated migration at `d6bdcf4`; do not replace it with the older broad `physical-%` exception.
5. Deploy the integrated app and Edge functions only after approved release. Keep `PAYPER_CHECK_DISPATCH_ENABLED` false. Keep `PAYPER_CASH_DISPATCH_ENABLED` false until the approved provider acceptance test confirms the exact cash contract. Existing digital Pelecard and continuous Payper configuration remain untouched.

## Exact cash request prepared for a controlled test

For a synthetic scheduled order `ORD-TEST` with saved total ₪1,000, no verified prior payment, a taxable customer snapshot, complete billing, no prior accounting document and no unresolved payment, the server calculates `paidMinor=0` and `balanceMinor=100000`. The cashier uses **גבייה בקופה** and sends `action=collect`, the existing `orderId`, a fresh UUID `requestKey`, `method=cash`, `amountMinor=100000`, `documentType=invoice-receipt`, `referenceDocumentId=null`, `check=null`, and the saved billing identity. The database locks the order and rejects any stale or different amount.

The resulting Payper request shape from `buildNoncardPayperRequest` is below. Placeholder credentials and customer values are illustrative; no request was sent to Payper.

```json
{
  "terminalNumber": "<approved terminal>",
  "user": "<approved user>",
  "password": "<approved password>",
  "trxRecordId": "",
  "Uid": "",
  "PayperParameters": {
    "typeDocument": "invoice-receipt",
    "DataPayper": {
      "document_lang": "hb",
      "customer_name": "Test Group",
      "customer_unique_id": "123456789",
      "customer_mail": "billing@example.invalid",
      "send_by_mail": "true",
      "document_subject": "RCP-TEST",
      "document_rounded": "false",
      "invoice_lines": [{ "description": "Group activity — ORD-TEST", "quantity": "1", "price_per_unit": "100000", "include_vat": "true" }],
      "receipt_lines": [{ "payment_type": "Cash", "date": "15-11-2026", "amount": 100000 }]
    }
  }
}
```

The [official Pelecard API documentation](https://docs.pelecard.com/documentation/create-payper-invoice-api/) lists `Cash` for `receipt_lines.payment_type`, requires receipt amount to equal the VAT-inclusive invoice total, permits empty `trxRecordId`/`Uid` for a cash Invoice-Receipt, and defines `send_by_mail` and customer fields. This request contains no check-specific remarks. Provider acceptance with the production account is still unverified.

## Offline test and acceptance criteria

`npm run test:full-schema` passed. The combined rehearsal also passed with the 18 `main` migrations, two production-only migrations, and terminal 1's latest `202611150002` extracted from remote integration commit `d6bdcf4`, applied in filename order. Its cash scenario asserts exactly one sale, one succeeded payment transaction, one accounting event and one Payper ledger row linked to the existing order; the order balance becomes zero. A mocked provider sees one POST, returns a document number and URL, and the ledger becomes `succeeded`. Repeating the same request key returns `created=false`; a second dispatch reservation is rejected. A different key attempting another full collection fails the balance check. No real payment or accounting document was created.

For the eventual approved controlled provider test, first inspect the selected order read-only: taxable customer snapshot, correct outstanding balance, no unresolved attempt, no prior invoice or Payper ledger issue. Record genuine received cash once through the schedule and confirm the real Payper response contains one official number and URL. If the provider response is uncertain, stop and reconcile; never retry document creation blindly.

## Handoff limits

The non-card schema and mocked cash path are ready for integration. The known production table, policy and trigger differences have been reconciled in the isolated replay, but it is not a live production clone. The integrated production release remains gated by source reconciliation, a controlled staging rehearsal with the actual production schema and data shape, and approved Payper cash acceptance. Check dispatch remains disabled pending Pelecard's check-detail answer. Terminal 1 owns the final integrated release and approval gate.
