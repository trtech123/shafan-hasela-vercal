# Rivhit Accounting Integration Design

**Date:** 2026-09-07  
**Branch:** `workstream/rivhit-accounting`  
**Base:** `c8a0663a35ae8254211194e3712519b79a1afe54`

## Goal

Add a standalone, server-side Rivhit accounting path that can find or create a Rivhit customer, create a configurable Rivhit test document for an existing Shafan order, and persist the external accounting state without depending on Pelecard or iCredit.

This work does not connect payment providers to Rivhit, deploy an Edge Function, apply a Production migration, or select final Production accounting document types.

## Existing System Findings

- There is no canonical `customers` table. Customer data is duplicated across leads, quotes, and orders. Orders are the strongest current billing source because they contain client contact fields plus seven institutional billing fields.
- `orders` contains `client_name`, `client_phone`, `client_email`, `organization`, price and payment state, and institutional fields such as `billing_institution_name`, `billing_company_id`, and `billing_accounting_email`.
- `sales` contains local point-of-sale rows and generates local `RCP-*` receipt numbers. These rows and rendered receipts are not Rivhit documents and must never be treated as such.
- `sales.order_id` and `sales.linked_order_info` can associate a local sale with an order, but this work will not trigger accounting from sales or payment activity.
- The private `documents` Storage bucket accepts PDFs, but no table currently tracks external accounting documents. Rivhit returns its own document identity, number, and URL, so copying its PDF into Storage is unnecessary for this phase.
- Existing RLS grants financial access to admin/operations and restricted access to cashiers. Edge Functions follow a JWT-authentication pattern and use the service role only after authorization.

## Official Rivhit Contract

- All Rivhit accounting environments use `https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/`; the account token selects the test or Production account.
- `Customer.Get` can locate a customer by Rivhit customer ID, email, third-party `acc_ref`, ID number, or VAT number.
- `Customer.New` returns `data.customer_id` and accepts a unique `request_reference`. Its `acc_ref` accepts up to 20 characters.
- `Document.New` requires a document type, customer information, and items. A successful response includes `document_type`, `document_number`, `customer_id`, `document_identity`, and `document_link`.
- Rivhit duplicate prevention requires a stable `request_reference` together with `prevent_duplicates=true`. Reusing a processed request can return error `-107` (`REQUEST_ALREADY_PROCESSED`).
- Rivhit API failures may arrive as non-2xx HTTP responses or as JSON whose `error_code` is nonzero.
- The shared test account is visible to all test users. Live verification must therefore use synthetic names, email addresses, telephone numbers, and line items only.

## Architecture

### 1. Additive accounting ledger

Migration `021_rivhit_accounting.sql` creates two generic tables without altering existing orders, sales, receipts, or storage:

#### `accounting_customers`

- `id` UUID primary key.
- `provider` text; this phase writes `rivhit`.
- `identity_key` text containing a one-way hash-derived local identity, never raw phone/email/company data.
- `external_customer_id` text for the Rivhit customer number.
- `external_reference` text for the deterministic Rivhit `acc_ref`.
- `status`: `pending`, `processing`, `succeeded`, `retryable_error`, `permanent_error`, or `reconciliation_required`.
- `attempt_count`, `last_attempt_at`, `retry_after`, and structured `last_error` JSONB.
- `created_at` and `updated_at`.
- Unique provider/identity and provider/external-reference constraints.

#### `accounting_documents`

- `id` UUID primary key.
- `provider` text.
- `accounting_customer_id` foreign key to `accounting_customers`.
- `source_type` and `source_id`; this phase accepts only `order`, while the schema can represent later source types.
- `document_type_key`, the internal configurable mapping name.
- `external_document_type`, the Rivhit numeric type resolved on the server.
- `status` using the same observable lifecycle states.
- `request_reference`, `payload_hash`, `external_document_id`, `external_document_number`, and `document_url`.
- `attempt_count`, `last_attempt_at`, `retry_after`, structured `last_error`, `created_at`, and `updated_at`.
- Unique provider/source/type-key and provider/request-reference constraints.

Foreign-key and lookup columns receive indexes. RLS permits admin/operations read access and defines no client-side insert/update/delete policies. The service role performs writes after the Edge Function authenticates and authorizes the caller.

Short, security-definer claim functions atomically create or reclaim customer/document work. They never hold a database transaction open during a Rivhit HTTP request. Execute permission is revoked from public, anon, and authenticated roles and granted only to `service_role`.

The migration is expand-only. Rollback consists of dropping the new claim functions, policies, indexes, and tables; no existing data needs transformation or restoration.

### 2. Server-side Rivhit client

Focused shared modules implement:

- JSON POST requests to `Customer.Get`, `Customer.New`, and `Document.New`.
- Strict response validation, including `error_code === 0` and required success fields.
- A typed `RivhitError` carrying HTTP status, Rivhit error code, messages, and retry classification.
- Retry classification: network errors, HTTP 408/429, and HTTP 5xx are retryable; validation/authentication errors and other HTTP 4xx responses are permanent. Rivhit `-107` becomes `reconciliation_required` when no local success record exists because retrying cannot safely reconstruct the original link from the documented response.
- Exponential retry metadata calculated locally; retries occur only on a later explicit invocation after `retry_after`.

The API token is read only from `RIVHIT_API_TOKEN` in the Edge Function environment. It is never accepted in request JSON, returned in responses, logged, or referenced by frontend code.

### 3. Configurable document mapping

`RIVHIT_DOCUMENT_TYPE_MAP` is a server-side JSON object keyed by a business mapping name. Each entry supplies the Rivhit `document_type` plus behavior that requires an accounting decision:

```json
{
  "sandbox_test": {
    "document_type": 1,
    "sort_code": 100,
    "currency_id": 1,
    "price_include_vat": true,
    "send_mail": false,
    "digital_signature": false
  }
}
```

This example is used only in a local live-sandbox command. No Production mapping or default is committed. Missing, malformed, or incomplete mapping entries fail before any Rivhit document request.

### 4. Order adapter and customer identity

The Edge Function loads the order and activity server-side. It never trusts billing or price fields supplied by the caller.

For the current order source:

- Customer display name priority: `billing_institution_name`, `organization`, then `client_name`.
- Accounting email priority: `billing_accounting_email`, then `client_email`.
- Customer identity priority: normalized `billing_company_id`, normalized accounting/client email, normalized client phone, then the order UUID as a last-resort isolated identity.
- The stored `identity_key` is a SHA-256 digest of the selected identity input.
- Rivhit `acc_ref` is `sh` plus the first 18 lowercase hexadecimal digest characters, fitting the documented 20-character maximum.
- No Israeli ID/VAT number is sent in this phase. Whether `billing_company_id` represents a validated company/VAT number remains a Production business decision.
- One document item is built from the activity name and order number. Quantity and unit price use `num_participants` and `price_per_person` when both are valid; otherwise quantity is 1 and price is `total_price`.
- The order number is sent in Rivhit's `order` field when it fits the documented length.

### 5. Orchestration and idempotency

The JWT-protected `rivhit-accounting` Edge Function accepts:

```json
{
  "sourceType": "order",
  "sourceId": "<order UUID>",
  "documentTypeKey": "sandbox_test"
}
```

The flow is:

1. Authenticate the caller and require role `admin` or `operations`.
2. Load and validate the source order and activity with a server-side Supabase client.
3. Resolve the document mapping from server environment.
4. Derive customer identity, request references, and a canonical payload hash.
5. Atomically claim the customer ledger row.
6. If no Rivhit ID is stored, call `Customer.Get` by `acc_ref`; create with `Customer.New` only when Rivhit reports no data; persist the returned customer ID.
7. Atomically claim the document ledger row. If already succeeded, return the persisted result without calling Rivhit.
8. Call `Document.New` with the stored customer ID, configured document behavior, stable `request_reference`, and `prevent_duplicates=true`.
9. Persist identifiers, number, URL, and succeeded status, then return them.
10. On failure, persist the error and retry metadata before returning a controlled error response.

The local unique constraints prevent concurrent duplicate work. Rivhit's request reference protects the remote side if a request is retried after an ambiguous network failure. A payload hash prevents silently reusing an idempotency identity after source accounting data changes.

### 6. Testing and sandbox proof

Automated tests cover:

- Customer found by `acc_ref` without creation.
- Missing customer created once and persisted.
- Document creation and persistence of all returned identifiers/link.
- Re-running a succeeded request returns local state without a second Rivhit document call.
- Retryable failures persist attempt count, error, and `retry_after` and can be reclaimed after the retry window.
- Active processing and not-yet-due retries do not call Rivhit.
- Network failures, malformed JSON, missing fields, HTTP failures, and nonzero Rivhit error responses.
- Configuration validation, payload stability, and order-to-Rivhit mapping.
- Static migration contract checks for additive tables, constraints, RLS, indexes, and service-role-only claim functions.

The live sandbox script uses synthetic order data and a file-backed temporary ledger under ignored `.tmp/`. It invokes the same connector and orchestration core twice. The first run must obtain and persist a Rivhit customer/document ID and URL. The second run must return the stored result with zero additional `Document.New` calls. This proves the complete behavior without applying the migration to Production.

Because Docker is not installed and no non-Production Supabase project was supplied, this phase cannot execute the migration or Edge Function against a real local Supabase stack. Automated repository-contract tests and the live Rivhit sandbox proof are reported separately; this limitation must remain explicit.

## Production Safety and Required Configuration

Production remains disabled until all of the following are supplied and explicitly approved:

- A Rivhit Online/Invoice Online Production API token stored as Edge Function secret `RIVHIT_API_TOKEN`.
- A reviewed `RIVHIT_DOCUMENT_TYPE_MAP` containing every approved business mapping.
- Explicit `RIVHIT_ACCOUNTING_MODE=production`; local verification uses `sandbox`.
- Confirmation that the Production Rivhit account's document types, sort codes, currency settings, VAT configuration, email defaults, and signature settings match the approved mapping.
- A migration application window and explicit approval to apply `021_rivhit_accounting.sql`.
- Explicit approval to deploy the `rivhit-accounting` Edge Function.

## Business and Accountant Decisions Still Required

- Regular paid order document type and whether it includes a receipt/payment array.
- Institutional or deferred-billing document type, due-date rules, and paying-customer behavior.
- Recurring-payment document type; no recurring provider is connected in this phase.
- Refund, partial-refund, cancellation, and credit-document mappings, including negative amount rules and document closing/cancellation behavior.
- Whether order/customer prices include VAT, the correct account-specific VAT sort code, and exempt-customer handling.
- Currency per flow, foreign-currency exchange-rate source, and rounding policy.
- Whether Rivhit emails documents automatically, which address/BCC to use, and whether Shafan sends separately.
- Whether documents require a Rivhit digital signature and whether the account needs a support-provided signature PIN.
- Whether `billing_company_id` is validated and should be sent as `vat_number`, and whether signer IDs ever belong on accounting records.
- Customer deduplication priority when company ID, email, and phone identify conflicting existing customers.
- Exact line-item wording, aggregation rules, catalog/item IDs, discounts, and inventory-update behavior.
- Who may manually trigger/retry/reconcile accounting documents in the future UI; this phase exposes no frontend trigger.

## Acceptance Criteria

1. Only additive Rivhit-specific files and generic accounting tables are introduced.
2. No frontend bundle contains a Rivhit token or direct Rivhit request.
3. No document can be created without an explicit server-side mapping key.
4. Customer find/create, document creation, persistence, duplicate prevention, retries, and failures have automated coverage.
5. A synthetic live Rivhit sandbox run returns a customer ID, document identity/number/link, persists them locally, and produces no second document on re-run.
6. Existing local `RCP-*` receipts remain unchanged and are never labeled as Rivhit documents.
7. Pelecard and iCredit code paths remain untouched.
8. No migration, function, or configuration is applied or deployed to Production.
