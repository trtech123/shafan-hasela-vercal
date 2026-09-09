# Payment Accounting Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each durable verified Pelecard success into one safely retryable Rivhit accounting operation while preserving payment success independently.

**Architecture:** Migration 027 creates a provider-neutral accounting outbox and atomic lease/fence RPCs, populated only by the durable local payment transition. A dependency-injected processor reloads local financial truth, maps the payment under semantic key `payment_success`, and reuses `runRivhitAccounting`; a protected worker and operations page expose retries and outcomes.

**Tech Stack:** PostgreSQL/Supabase RLS and RPCs, Supabase Edge Functions (Deno TypeScript), React/Vite, Vitest.

---

### Task 1: Durable accounting event and database contracts

**Files:**
- Create: `supabase/migrations/027_payment_accounting_orchestration.sql`
- Create: `app/src/payments/paymentAccountingMigration.contract.test.js`
- Create: `supabase/tests/payment_accounting_orchestration.sql`

- [ ] **Step 1: Write the failing migration contract**

Assert that 027 creates `accounting_events`, uniqueness on `(source_type, source_id, purpose, accounting_provider)`, statuses `pending|processing|succeeded|retryable_error|permanent_error|reconciliation_required|configuration_required`, an atomic success-transition trigger, `FOR UPDATE SKIP LOCKED`, lease token/expiry, attempt fencing, admin/ops SELECT RLS, service-role-only mutation RPCs, an operations view, and no iCredit source trigger or historical backfill.

- [ ] **Step 2: Run the contract and prove RED**

Run `npm test --prefix app -- src/payments/paymentAccountingMigration.contract.test.js`; expect failure because migration 027 does not exist.

- [ ] **Step 3: Implement the additive migration**

Create the table and functions with these public boundaries:

```sql
CREATE TABLE public.accounting_events (...);
CREATE OR REPLACE FUNCTION public.enqueue_verified_payment_accounting() RETURNS TRIGGER;
CREATE OR REPLACE FUNCTION public.claim_accounting_event(
  p_event_id UUID, p_worker_id UUID, p_lease_seconds INTEGER DEFAULT 300,
  p_force_retry BOOLEAN DEFAULT FALSE
) RETURNS TABLE (..., claimed BOOLEAN, attempt_count INTEGER, lease_token UUID);
CREATE OR REPLACE FUNCTION public.complete_accounting_event(
  p_event_id UUID, p_attempt_count INTEGER, p_lease_token UUID
) RETURNS BOOLEAN;
CREATE OR REPLACE FUNCTION public.fail_accounting_event(
  p_event_id UUID, p_attempt_count INTEGER, p_lease_token UUID,
  p_status TEXT, p_next_attempt_at TIMESTAMPTZ, p_last_error JSONB
) RETURNS BOOLEAN;
```

The trigger inserts only after a locally verified Pelecard `payment` first enters `succeeded`; it inserts source type `payment_transaction`, purpose `payment_success`, accounting provider `rivhit`, and uses `ON CONFLICT DO NOTHING`. It must not update payment state. The operations view joins payment, sale/order identity, and matching accounting document while deriving `retry_allowed` server-side.

- [ ] **Step 4: Run contract and SQL-shape tests**

Run the focused Vitest contract and, when a local Supabase database is available, `supabase test db supabase/tests/payment_accounting_orchestration.sql`. If no local database exists, retain the SQL test and report that runtime execution is unavailable rather than deleting it.

- [ ] **Step 5: Commit**

Commit as `feat(accounting): add durable payment accounting outbox`.

### Task 2: Payment mapper, event repository, and orchestration processor

**Files:**
- Create: `supabase/functions/_shared/payment-accounting/types.ts`
- Create: `supabase/functions/_shared/payment-accounting/payment-mapper.ts`
- Create: `supabase/functions/_shared/payment-accounting/payment-mapper.test.ts`
- Create: `supabase/functions/_shared/payment-accounting/repository.ts`
- Create: `supabase/functions/_shared/payment-accounting/repository.test.ts`
- Create: `supabase/functions/_shared/payment-accounting/processor.ts`
- Create: `supabase/functions/_shared/payment-accounting/processor.test.ts`
- Modify: `supabase/functions/_shared/rivhit/types.ts`
- Modify: `supabase/functions/_shared/rivhit/order-mapper.ts`

- [ ] **Step 1: Write failing mapper tests**

Prove that a payment source uses payment UUID/amount/items, semantic `payment_success`, stable references/hash, order billing identity, and no raw callback fields. Prove an unlinked payment becomes a reconciliation error rather than a fabricated customer.

- [ ] **Step 2: Prove mapper RED, then implement minimal shared mapping**

Widen `MappedAccountingSource.sourceType` to `order | payment_transaction`. Reuse/export only the stable customer identity helpers needed from the order mapper. The payment mapper must produce `shafan:rivhit:payment:<payment-id>:payment_success` and item totals equal to the local payment amount.

- [ ] **Step 3: Write failing repository/processor tests**

Cover duplicate claim, retryable failure/backoff, permanent failure, reconciliation ambiguity, configuration-required mapping, stable idempotency, successful event completion, and stale attempt fencing. Assert the processor reloads and validates `provider=pelecard`, `operation=payment`, `status=succeeded`, `verified_at`, `provider_transaction_id`, and `sale_id` before calling Rivhit.

- [ ] **Step 4: Implement repository and processor**

Use these dependency boundaries:

```ts
export interface AccountingEventRepository {
  claim(eventId: string, options?: { forceRetry?: boolean }): Promise<AccountingEventClaim>;
  loadVerifiedPelecardSource(sourceId: string): Promise<VerifiedPaymentSource | null>;
  complete(claim: AccountingEventClaim): Promise<void>;
  fail(claim: AccountingEventClaim, failure: EventFailure): Promise<void>;
}

export async function processAccountingEvent(options: {
  eventId: string;
  repository: AccountingEventRepository;
  rivhitRepository: AccountingRepository;
  rivhitClient: RivhitAccountingClient;
  documentMappings: Record<string, DocumentMapping>;
  accountNamespace: string;
  forceRetry?: boolean;
  now?: () => Date;
}): Promise<AccountingEventResult>;
```

Call the existing `runRivhitAccounting()` exactly once per claimed attempt. Mirror its result or classified `RivhitError` to the event. Never write to `payment_transactions`, `sales`, or `orders`.

- [ ] **Step 5: Run focused tests and commit**

Run all new shared tests plus existing Rivhit workflow/mapper/repository tests; commit as `feat(accounting): orchestrate verified payment documents`.

### Task 3: Verified-success wake-up and protected worker

**Files:**
- Modify: `supabase/functions/_shared/payment-handlers.ts`
- Modify: `supabase/functions/_shared/payment-edge-runtime.ts`
- Modify: `app/src/payments/edge/pelecardHandlers.test.js`
- Create: `supabase/functions/payment-accounting-worker/index.ts`
- Create: `supabase/functions/payment-accounting-worker/handler.ts`
- Create: `supabase/functions/payment-accounting-worker/handler.test.ts`

- [ ] **Step 1: Add failing payment-boundary tests**

Add `onPaymentSucceeded(paymentId)` as an optional dependency. Prove it is called only with the local UUID after durable finalize, callback-body fields are never passed, duplicate successful notifications cannot create another event/document, and hook rejection still returns the succeeded payment response.

- [ ] **Step 2: Implement the post-success hook safely**

Invoke the hook for a newly finalized payment and an already-local-succeeded payment. Wrap it so failure cannot alter the response or call `markFailed`. Runtime composition receives only the service client and server environment.

- [ ] **Step 3: Add failing worker handler tests**

Cover method/auth/role validation, event UUID validation, configuration-required behavior, manual force retry, and response codes for success/retry/permanent/reconciliation. Ensure request bodies cannot supply provider credentials, numeric document type, payment state, amount, source payload, or callback data.

- [ ] **Step 4: Implement and compose worker**

The endpoint accepts only `{ eventId, forceRetry? }`, authenticates admin/operations, loads all source/config server-side, and calls `processAccountingEvent`. A shared internal dispatcher used by payment runtime accepts only `paymentId` and resolves the matching outbox event server-side.

- [ ] **Step 5: Run Pelecard and worker suites, then commit**

Run payment handler/initiation/reconciliation/store contracts and all new worker tests. Commit as `feat(accounting): dispatch verified payment accounting`.

### Task 4: Accounting operations UI

**Files:**
- Create: `app/src/pages/AccountingOperations.jsx`
- Create: `app/src/pages/AccountingOperations.test.jsx`
- Modify: `app/src/App.jsx`
- Modify: `app/src/components/Layout.jsx`
- Modify: `app/src/components/Layout.test.jsx`

- [ ] **Step 1: Write failing UI/route tests**

Render mixed succeeded, retryable, permanent, reconciliation, and configuration rows. Assert Hebrew source/amount/time/status/document/attempt/error/retry fields, safe document link attributes, retry invocation with only the event ID, refresh after success, and admin/operations route access while cashier/instructor are redirected.

- [ ] **Step 2: Implement the page and navigation**

Add `/accounting-operations` labeled `תפעול הנהלת חשבונות`. Query the protected view, render compact responsive cards/table, and invoke `payment-accounting-worker` for eligible rows. Do not expose any control that updates payment status.

- [ ] **Step 3: Run focused UI tests and commit**

Run page and Layout tests plus focused ESLint/TypeScript diagnostics. Commit as `feat(accounting): add operations visibility and retry`.

### Task 5: Payment-accounting verification

- [ ] Run all new accounting tests, existing full Rivhit tests, complete Pelecard tests, migration contracts, full app suite, build, focused lint, touched-file TypeScript checks, and `git diff --check`.
- [ ] Confirm grep finds no `icredit` trigger/source in 027/worker and no accounting import in Order Confirmation PDF files.
- [ ] Record exact pass/fail evidence and external activation blockers in `PROGRESS.md`.
- [ ] Commit verification documentation as `docs: record payment accounting verification`.

