# Pelecard Hosted Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sandbox-ready, server-verified Pelecard Redirect/IFrame 2.0 payment flow whose ledger, sale creation, order state, callbacks, and capability-gated refunds are idempotent and contain no card data.

**Architecture:** Supabase Edge Functions own all provider communication and expose only hosted redirect URLs and sanitized payment state. PostgreSQL stores immutable payment identity plus append-only lifecycle events; a service-role-only finalizer locks one payment row and atomically creates its sale and updates its order. Existing `אשראי` remains manual/external, while verified provider payments use `פלאקארד`.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Supabase Edge Functions (Deno TypeScript), React 18/Vite, Vitest, Pelecard IFrame/Redirect 2.0 hosted flow.

---

## File Map

- `supabase/migrations/021_pelecard_payment_ledger.sql` — additive ledger tables, constraints, indexes, immutable-event triggers, RLS, sale link, and distinct order payment state.
- `app/src/payments/paymentMigration.contract.test.js` — locally runnable contract checks for migration safety and card-data exclusions.
- `supabase/functions/_shared/payment-types.ts` — provider-neutral payment states and sanitized types.
- `supabase/functions/_shared/pelecard-client.ts` — hosted init, confirmation validation, lookup, and gated cancellation client.
- `supabase/functions/_shared/payment-reconciliation.ts` — pure verification and mismatch decisions.
- `supabase/functions/_shared/payment-auth.ts` — authenticated staff/admin authorization.
- `supabase/functions/_shared/payment-http.ts` — request parsing, CORS, body limits, and safe responses.
- `supabase/functions/_shared/payment-store.ts` — ledger persistence and finalization RPC calls.
- `supabase/functions/pelecard-initiate/index.ts` — authenticated idempotent checkout initialization.
- `supabase/functions/pelecard-callback/index.ts` — public provider callback, followed by mandatory verification.
- `supabase/functions/pelecard-verify/index.ts` — authenticated on-demand reconciliation.
- `supabase/functions/pelecard-status/index.ts` — authenticated safe local lookup.
- `supabase/functions/pelecard-refund/index.ts` — admin-only capability-gated cancellation.
- `app/src/payments/edge/pelecardClient.test.js` — provider adapter fixtures and no-sensitive-data assertions.
- `app/src/payments/edge/paymentReconciliation.test.js` — success, failure, forgery, mismatch, timeout, and duplicate cases.
- `app/src/payments/edge/pelecardHandlers.test.js` — handler auth/idempotency/capability contracts.
- `supabase/migrations/022_pelecard_atomic_finalization.sql` — service-role-only atomic finalizer and verified-state guards.
- `supabase/tests/pelecard_atomic_finalization.sql` — database integration proof for repeated finalization.
- `app/src/payments/pelecardPayments.js` — frontend calls for initiate/status/verify.
- `app/src/pages/PaymentReturn.jsx` — safe return/polling screen.
- `app/src/components/cashregister/PaymentScreen.jsx` — separate external-credit and Pelecard choices.
- `app/src/pages/CashRegister.jsx` — redirect initiation and restored pending checkout state.
- `app/src/App.jsx` — authenticated payment-return route.
- `app/src/payments/pelecardPayments.test.js` — frontend API and repeated-polling tests.
- `app/src/components/cashregister/PaymentScreen.pelecard.test.jsx` — payment-method separation tests.

## Phase 2 — Payment Data Model

### Task 1: Write the migration contract first

**Files:**
- Create: `app/src/payments/paymentMigration.contract.test.js`
- Test: `app/src/payments/paymentMigration.contract.test.js`

- [ ] **Step 1: Write the failing contract test**

```js
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../../supabase/migrations/021_pelecard_payment_ledger.sql", import.meta.url),
);

const readMigration = () => existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

describe("Pelecard payment ledger migration", () => {
  test("migration exists", () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  test("creates the transaction and append-only event ledgers", () => {
    const normalized = readMigration().replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
    expect(normalized).toContain("create table public.payment_transactions");
    expect(normalized).toContain("create table public.payment_transaction_events");
    expect(normalized).toContain("alter table public.payment_transactions enable row level security");
    expect(normalized).toContain("alter table public.payment_transaction_events enable row level security");
  });

  test("enforces provider and idempotency uniqueness", () => {
    const normalized = readMigration().replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
    expect(normalized).toMatch(/unique index[^;]+provider[^;]+provider_transaction_id/);
    expect(normalized).toMatch(/unique[^;]+provider[^;]+idempotency_key/);
    expect(normalized).toMatch(/unique index[^;]+sale_id[^;]+where sale_id is not null/);
  });

  test("does not define card-data columns", () => {
    const normalized = readMigration().replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
    for (const forbidden of ["pan", "cvv", "card_number", "card_expiry", "expiry_date", "card_token"]) {
      expect(normalized).not.toMatch(new RegExp(`\\b${forbidden}\\s+(text|varchar|jsonb)`));
    }
  });

  test("keeps external credit distinct from verified Pelecard", () => {
    const sql = readMigration();
    const normalized = sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
    expect(sql).toContain("'אשראי'");
    expect(sql).toContain("'פלאקארד'");
    expect(normalized).toContain("payment_transaction_id");
  });

  test("blocks authenticated ledger mutation and makes events append-only", () => {
    const normalized = readMigration().replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
    expect(normalized).toContain("revoke insert, update, delete on public.payment_transactions from anon, authenticated");
    expect(normalized).toContain("revoke insert, update, delete on public.payment_transaction_events from anon, authenticated");
    expect(normalized).toContain("before update or delete on public.payment_transaction_events");
    expect(normalized).toContain("before delete on public.payment_transactions");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run src/payments/paymentMigration.contract.test.js --maxWorkers=1` from `app/`  
Expected: FAIL because `021_pelecard_payment_ledger.sql` does not exist.

- [ ] **Step 3: Commit the failing test**

```powershell
git add app/src/payments/paymentMigration.contract.test.js
git commit -m "test: define Pelecard ledger contract"
```

### Task 2: Implement the additive ledger migration

**Files:**
- Create: `supabase/migrations/021_pelecard_payment_ledger.sql`
- Create: `supabase/tests/pelecard_payment_ledger.sql`
- Test: `app/src/payments/paymentMigration.contract.test.js`

- [ ] **Step 1: Create the migration with this structure**

Define immutable `payment_checkout_snapshot_is_safe(jsonb)` and
`payment_event_metadata_is_safe(jsonb)` validators first. They must allow only
the explicitly documented business/event shapes and reject every unknown key;
they are not provider-payload filters.

```sql
create table public.payment_transactions (
  id uuid primary key default uuid_generate_v4(),
  provider text not null default 'pelecard' check (provider = 'pelecard'),
  operation text not null default 'payment' check (operation in ('payment', 'refund', 'void')),
  parent_transaction_id uuid references public.payment_transactions(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  sale_id uuid,
  provider_session_id text,
  provider_transaction_id text,
  approval_id text,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'initiated' check (status in (
    'initiated', 'pending_provider', 'succeeded', 'failed', 'timed_out',
    'refund_pending', 'refunded', 'void_pending', 'voided'
  )),
  idempotency_key text not null check (
    idempotency_key = btrim(idempotency_key)
    and length(idempotency_key) between 8 and 100
  ),
  provider_status_code text,
  failure_code text,
  failure_message text,
  checkout_snapshot jsonb not null default '{}'::jsonb check (
    jsonb_typeof(checkout_snapshot) = 'object'
    and public.payment_checkout_snapshot_is_safe(checkout_snapshot)
  ),
  created_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_transactions_parent_required check (
    (operation = 'payment' and parent_transaction_id is null)
    or (operation in ('refund', 'void') and parent_transaction_id is not null)
  ),
  constraint payment_transactions_provider_id_nonblank check (
    provider_transaction_id is null or btrim(provider_transaction_id) <> ''
  ),
  constraint payment_transactions_failure_message_length check (
    failure_message is null or length(failure_message) <= 500
  ),
  unique (provider, idempotency_key)
);

create unique index uq_payment_transactions_provider_transaction
  on public.payment_transactions(provider, provider_transaction_id)
  where provider_transaction_id is not null;
create unique index uq_payment_transactions_sale
  on public.payment_transactions(sale_id) where sale_id is not null;
create index idx_payment_transactions_order_id on public.payment_transactions(order_id);
create index idx_payment_transactions_parent_id on public.payment_transactions(parent_transaction_id);
create index idx_payment_transactions_created_by on public.payment_transactions(created_by);
create index idx_payment_transactions_pending on public.payment_transactions(created_at)
  where status in ('initiated', 'pending_provider', 'timed_out');

create table public.payment_transaction_events (
  id uuid primary key default uuid_generate_v4(),
  payment_transaction_id uuid not null references public.payment_transactions(id) on delete restrict,
  event_type text not null,
  status text not null,
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and public.payment_event_metadata_is_safe(metadata)
  ),
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index idx_payment_transaction_events_transaction_created
  on public.payment_transaction_events(payment_transaction_id, created_at);

alter table public.sales add column if not exists payment_transaction_id uuid;
alter table public.sales add constraint sales_payment_transaction_id_fkey
  foreign key (payment_transaction_id) references public.payment_transactions(id) on delete restrict;
alter table public.payment_transactions add constraint payment_transactions_sale_id_fkey
  foreign key (sale_id) references public.sales(id) on delete restrict;
create unique index uq_sales_payment_transaction_id
  on public.sales(payment_transaction_id) where payment_transaction_id is not null;

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check check (
  payment_status in ('לא שולם', 'שובר', 'אשראי', 'צ''ק', 'מזומן', 'פלאקארד')
) not valid;
alter table public.orders validate constraint orders_payment_status_check;
```

Append the following enforcement SQL:

```sql
create or replace function public.reject_payment_ledger_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'payment ledger rows are immutable' using errcode = '42501';
end;
$$;

create or replace function public.protect_payment_transaction_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.provider, new.operation, new.parent_transaction_id, new.order_id,
         new.amount, new.currency, new.idempotency_key, new.checkout_snapshot, new.created_at)
     is distinct from
     row(old.provider, old.operation, old.parent_transaction_id, old.order_id,
         old.amount, old.currency, old.idempotency_key, old.checkout_snapshot, old.created_at) then
    raise exception 'payment transaction identity is immutable' using errcode = '42501';
  end if;
  if old.provider_session_id is not null
     and new.provider_session_id is distinct from old.provider_session_id then
    raise exception 'provider session id is immutable once assigned' using errcode = '42501';
  end if;
  if old.provider_transaction_id is not null
     and new.provider_transaction_id is distinct from old.provider_transaction_id then
    raise exception 'provider transaction id is immutable once assigned' using errcode = '42501';
  end if;
  if old.approval_id is not null and new.approval_id is distinct from old.approval_id then
    raise exception 'approval id is immutable once assigned' using errcode = '42501';
  end if;
  if old.sale_id is not null and new.sale_id is distinct from old.sale_id then
    raise exception 'sale link is immutable once assigned' using errcode = '42501';
  end if;
  if old.verified_at is not null and new.verified_at is distinct from old.verified_at then
    raise exception 'verification time is immutable once assigned' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.record_payment_transaction_event()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.payment_transaction_events (
      payment_transaction_id, event_type, status, metadata, actor_id
    ) values (
      new.id,
      case when tg_op = 'INSERT' then 'created' else 'status_changed' end,
      new.status,
      jsonb_strip_nulls(jsonb_build_object(
        'previous_status', case when tg_op = 'UPDATE' then old.status end,
        'provider_status_code', new.provider_status_code,
        'failure_code', new.failure_code
      )),
      coalesce(auth.uid(), new.created_by)
    );
  end if;
  return new;
end;
$$;

create or replace function public.protect_order_pelecard_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and new.payment_status = 'פלאקארד'
     and (tg_op = 'INSERT' or old.payment_status is distinct from new.payment_status) then
    raise exception 'verified Pelecard state is server-managed' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and coalesce(auth.role(), '') <> 'service_role'
     and old.payment_status = 'פלאקארד'
     and new.payment_status is distinct from old.payment_status then
    raise exception 'verified Pelecard state is server-managed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.protect_sale_pelecard_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (new.method = 'פלאקארד' or new.payment_transaction_id is not null) then
    raise exception 'verified Pelecard sales are server-managed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_payment_transactions_identity
  before update on public.payment_transactions
  for each row execute function public.protect_payment_transaction_identity();
create trigger trg_payment_transactions_no_delete
  before delete on public.payment_transactions
  for each row execute function public.reject_payment_ledger_delete();
create trigger trg_payment_transaction_events_immutable
  before update or delete on public.payment_transaction_events
  for each row execute function public.reject_payment_ledger_delete();
create trigger trg_payment_transactions_no_truncate
  before truncate on public.payment_transactions
  for each statement execute function public.reject_payment_ledger_delete();
create trigger trg_payment_transaction_events_no_truncate
  before truncate on public.payment_transaction_events
  for each statement execute function public.reject_payment_ledger_delete();
create trigger trg_payment_transactions_created_event
  after insert on public.payment_transactions
  for each row execute function public.record_payment_transaction_event();
create trigger trg_payment_transactions_status_event
  after update of status on public.payment_transactions
  for each row execute function public.record_payment_transaction_event();
create trigger trg_payment_transactions_updated_at
  before update on public.payment_transactions
  for each row execute function public.update_updated_at();
create trigger trg_orders_protect_pelecard_insert
  before insert on public.orders
  for each row execute function public.protect_order_pelecard_state();
create trigger trg_orders_protect_pelecard_update
  before update of payment_status on public.orders
  for each row execute function public.protect_order_pelecard_state();
create trigger trg_sales_protect_pelecard_insert
  before insert on public.sales
  for each row execute function public.protect_sale_pelecard_state();
create trigger trg_sales_protect_pelecard_update
  before update of method, payment_transaction_id on public.sales
  for each row execute function public.protect_sale_pelecard_state();

alter table public.payment_transactions enable row level security;
alter table public.payment_transaction_events enable row level security;

create policy "payment transactions: staff read"
  on public.payment_transactions for select to authenticated
  using ((select public.is_admin_or_ops()) or (select public.is_cashier()));
create policy "payment transaction events: staff read"
  on public.payment_transaction_events for select to authenticated
  using ((select public.is_admin_or_ops()) or (select public.is_cashier()));

revoke all on public.payment_transactions from public, anon, authenticated, service_role;
revoke all on public.payment_transaction_events from public, anon, authenticated, service_role;
revoke insert, update, delete on public.payment_transactions from anon, authenticated;
revoke insert, update, delete on public.payment_transaction_events from anon, authenticated;
grant select on public.payment_transactions to authenticated;
grant select on public.payment_transaction_events to authenticated;
grant select, insert, update on public.payment_transactions to service_role;
grant select, insert on public.payment_transaction_events to service_role;
```

The final migration must also use strict allowlisted JSON shapes (never an open-ended
provider payload), length-bound and trim all unique provider identifiers, and validate
with a trigger that refund/void parents are succeeded original `payment` rows. Revoke
validator-function execution from `PUBLIC`, `anon`, and `authenticated` so the helpers
are not browser-callable RPCs.

- [ ] **Step 2: Run the contract test and verify GREEN**

Run: `npm test -- --run src/payments/paymentMigration.contract.test.js --maxWorkers=1` from `app/`  
Expected: 10 tests PASS.

- [ ] **Step 3: Verify migration hygiene**

Run: `npx supabase db lint --local`  
Expected in this workstation: command reports that the local database is unavailable because Docker is not installed. Record this environment limitation; do not link or apply the migration to the production project.

Run: `git diff --check`  
Expected: exit 0.

When a disposable local Supabase database is available, apply migrations locally and
run `supabase/tests/pelecard_payment_ledger.sql` with `ON_ERROR_STOP=1`. It verifies
real uniqueness, sensitive-shape rejection, parent integrity, event creation,
update/delete/TRUNCATE rejection, and role privileges, then rolls back every mutation.
Never run this behavior script against Production.

- [ ] **Step 4: Commit Phase 2**

```powershell
git add supabase/migrations/021_pelecard_payment_ledger.sql app/src/payments/paymentMigration.contract.test.js PROGRESS.md
git commit -m "feat: add immutable Pelecard payment ledger"
```

## Phase 3 — Server-side Provider Integration

### Task 3: Build and test the pure provider client

**Files:**
- Create: `supabase/functions/_shared/payment-types.ts`
- Create: `supabase/functions/_shared/pelecard-client.ts`
- Create: `app/src/payments/edge/pelecardClient.test.js`

- [ ] **Step 1: Write failing tests for init, validation, lookup, sanitization, timeout, and refund gating**

Define a complete Pelecard fixture containing documented fields, including card-number and expiry fields, then assert the returned `VerifiedProviderTransaction` contains only:

```ts
{
  providerTransactionId: "651650799",
  approvalId: "0000000",
  statusCode: "000",
  amountMinor: 10000,
  currencyCode: "ILS",
  terminalNumber: "sandbox-terminal-fixture",
  merchantKey: "payment-uuid"
}
```

Also assert invalid confirmation returns `forged_callback`, mismatched lookup identifiers return `provider_mismatch`, `AbortError` becomes `provider_timeout`, and cancellation returns `capability_disabled` without calling `fetch` when the gate is false.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run src/payments/edge/pelecardClient.test.js --maxWorkers=1` from `app/`  
Expected: FAIL because the shared modules do not exist.

- [ ] **Step 3: Implement the provider client**

Use a constructor contract that makes network calls injectable:

```ts
export function createPelecardClient(config: PelecardConfig, fetchFn: typeof fetch = fetch) {
  return {
    initiate: (input: InitiateProviderPayment) => initiate(config, input, fetchFn),
    validateConfirmation: (input: ConfirmationValidation) => validate(config, input, fetchFn),
    lookup: (providerTransactionId: string) => lookup(config, providerTransactionId, fetchFn),
    cancel: (providerTransactionId: string) => {
      if (!config.refundEnabled) throw new PaymentError("capability_disabled");
      return cancel(config, providerTransactionId, fetchFn);
    },
  };
}
```

Build every provider request from Edge secrets, use `AbortSignal.timeout`, parse JSON defensively, convert provider currency codes explicitly, and return allowlisted objects. Never log or return provider bodies.

- [ ] **Step 4: Run and verify GREEN, then commit**

```powershell
npm test -- --run src/payments/edge/pelecardClient.test.js --maxWorkers=1
git add supabase/functions/_shared app/src/payments/edge/pelecardClient.test.js
git commit -m "feat: add sanitized Pelecard provider client"
```

### Task 4: Build the reconciliation state machine

**Files:**
- Create: `supabase/functions/_shared/payment-reconciliation.ts`
- Create: `app/src/payments/edge/paymentReconciliation.test.js`

- [ ] **Step 1: Write failing table-driven tests**

Use this exact table and call `reconcilePayment(localPayment, callbackNotice, providerResult)` for each row:

| Case | Changed input | Expected decision |
| --- | --- | --- |
| verified success | none | `{ kind: "finalize" }` with the allowlisted provider transaction |
| decline | provider status `006` | `{ kind: "fail", code: "provider_declined" }` |
| forged callback | confirmation validation false | `{ kind: "fail", code: "forged_callback" }` |
| transaction mismatch | lookup transaction ID differs | `{ kind: "fail", code: "provider_mismatch" }` |
| terminal mismatch | lookup terminal differs | `{ kind: "fail", code: "provider_mismatch" }` |
| amount mismatch | lookup amount is 9,999 agorot | `{ kind: "fail", code: "amount_mismatch" }` |
| currency mismatch | lookup currency is USD | `{ kind: "fail", code: "currency_mismatch" }` |
| merchant-key mismatch | lookup merchant key differs | `{ kind: "fail", code: "provider_mismatch" }` |
| network timeout | provider result is `provider_timeout` | `{ kind: "remain_pending", code: "provider_timeout" }` |
| duplicate success | local status is `succeeded` | `{ kind: "already_finalized" }` |
| delayed success | local status is `timed_out`, valid success lookup | `{ kind: "finalize" }` |

```ts
const result = reconcilePayment(localPayment, callbackNotice, providerResult);
expect(result).toEqual(expectedDecision);
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run src/payments/edge/paymentReconciliation.test.js --maxWorkers=1` from `app/`  
Expected: FAIL because `reconcilePayment` is missing.

- [ ] **Step 3: Implement minimal pure reconciliation**

Return one of:

```ts
type ReconciliationDecision =
  | { kind: "finalize"; transaction: VerifiedProviderTransaction }
  | { kind: "already_finalized" }
  | { kind: "fail"; code: SafeFailureCode; message: string }
  | { kind: "remain_pending"; code: "provider_timeout" };
```

Comparison order must be confirmation validity, local terminal/correlation, provider transaction identity, provider success, amount, and currency. Never downgrade `succeeded`, `refunded`, or `voided`.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- --run src/payments/edge/paymentReconciliation.test.js --maxWorkers=1
git add supabase/functions/_shared/payment-reconciliation.ts app/src/payments/edge/paymentReconciliation.test.js
git commit -m "feat: add Pelecard reconciliation state machine"
```

### Task 5: Add authenticated initiation

**Files:**
- Create: `supabase/functions/_shared/payment-auth.ts`
- Create: `supabase/functions/_shared/payment-http.ts`
- Create: `supabase/functions/_shared/payment-store.ts`
- Create: `supabase/functions/pelecard-initiate/index.ts`
- Create: `app/src/payments/edge/pelecardHandlers.test.js`

- [ ] **Step 1: Write failing handler tests**

Test missing JWT, unauthorized role, invalid totals, duplicate key with identical input, duplicate key with changed amount, provider timeout, and successful hosted URL. The successful response must equal:

```ts
{ paymentId: "local-payment-id", status: "pending_provider", redirectUrl: "https://gateway20.pelecard.biz/..." }
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run src/payments/edge/pelecardHandlers.test.js --maxWorkers=1` from `app/`  
Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Implement initiation**

Accept `{ idempotencyKey, orderId?, checkout }`, validate items and discount arithmetic, convert the total to integer agorot, create/reuse the local ledger row, and call the hosted init endpoint. Source secrets only from:

```ts
const config = {
  terminal: requireEnv("PELECARD_TERMINAL"),
  user: requireEnv("PELECARD_USER"),
  password: requireEnv("PELECARD_PASSWORD"),
  baseUrl: Deno.env.get("PELECARD_BASE_URL") ?? "https://gateway20.pelecard.biz",
  appBaseUrl: requireEnv("PAYMENTS_APP_BASE_URL"),
  refundEnabled: Deno.env.get("PELECARD_REFUND_ENABLED") === "true",
};
```

Return the existing result for an identical idempotent retry and HTTP 409 for changed immutable input.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- --run src/payments/edge/pelecardHandlers.test.js --maxWorkers=1
git add supabase/functions/_shared supabase/functions/pelecard-initiate app/src/payments/edge/pelecardHandlers.test.js
git commit -m "feat: initiate hosted Pelecard payments"
```

### Task 6: Add callback, verify, status, and gated refund handlers

**Files:**
- Create: `supabase/functions/pelecard-callback/index.ts`
- Create: `supabase/functions/pelecard-verify/index.ts`
- Create: `supabase/functions/pelecard-status/index.ts`
- Create: `supabase/functions/pelecard-refund/index.ts`
- Modify: `app/src/payments/edge/pelecardHandlers.test.js`

- [ ] **Step 1: Extend failing handler tests**

Add one assertion per row:

| Request | Expected |
| --- | --- |
| URL-encoded valid callback | HTTP 200 and one reconciliation call |
| JSON valid callback | HTTP 200 and one reconciliation call |
| repeated valid callback | HTTP 200 and existing sale ID |
| malformed callback | HTTP 400, no provider call |
| body over 32 KiB | HTTP 413, no provider call |
| forged confirmation | HTTP 400 with `forged_callback`, no finalization |
| mismatched lookup | HTTP 409 with `provider_mismatch`, no finalization |
| provider timeout | HTTP 202 with `pending_provider` |
| two status reads | identical HTTP 200 projections and zero writes |
| operations-role refund | HTTP 403 |
| admin refund with gate false | HTTP 409 with `capability_disabled`, zero provider calls |
| admin refund with gate true and mocked success | HTTP 200 with refund operation ID |

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run src/payments/edge/pelecardHandlers.test.js --maxWorkers=1` from `app/`  
Expected: new cases FAIL because handlers are missing.

- [ ] **Step 3: Implement the four handlers to the response contracts below**

The callback must never authenticate by source IP alone and must never echo provider fields. `pelecard-status` returns only:

```ts
{
  id, orderId, saleId, amount, currency, status,
  failureCode, receiptNumber, createdAt, updatedAt, verifiedAt
}
```

The refund handler checks admin authorization and the capability flag before inserting or calling the provider.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- --run src/payments/edge/pelecardHandlers.test.js --maxWorkers=1
git add supabase/functions/pelecard-callback supabase/functions/pelecard-verify supabase/functions/pelecard-status supabase/functions/pelecard-refund app/src/payments/edge/pelecardHandlers.test.js
git commit -m "feat: reconcile and gate Pelecard operations"
```

## Phase 4 — Transaction Integrity and UI Wiring

### Task 7: Implement atomic database finalization

**Files:**
- Create: `supabase/migrations/022_pelecard_atomic_finalization.sql`
- Create: `supabase/tests/pelecard_atomic_finalization.sql`
- Modify: `supabase/functions/_shared/payment-store.ts`

- [ ] **Step 1: Write the failing SQL integration test**

Within one rolled-back transaction, create an order and pending payment, call `finalize_pelecard_payment` twice, and assert one sale, one payment-sale link, one `פלאקארד` order state, and one transition to success. Also assert authenticated direct attempts to create a `פלאקארד` sale or payment state fail.

- [ ] **Step 2: Verify RED against a disposable Supabase database**

Run: `psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pelecard_atomic_finalization.sql`  
Expected: FAIL because the finalizer does not exist. Never point `TEST_DATABASE_URL` at production.

- [ ] **Step 3: Implement the service-role-only finalizer**

Use `security definer set search_path = ''`, revoke execution from public/anon/authenticated, grant only to service_role, lock the payment row `for update`, validate all immutable expected values, return the existing sale on duplicate success, insert `sales.method = 'פלאקארד'`, update the order payment state, and update the ledger in the same function call.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pelecard_atomic_finalization.sql
git add supabase/migrations/022_pelecard_atomic_finalization.sql supabase/tests/pelecard_atomic_finalization.sql supabase/functions/_shared/payment-store.ts
git commit -m "feat: finalize Pelecard payments atomically"
```

### Task 8: Separate external credit and wire the hosted redirect

**Files:**
- Create: `app/src/payments/pelecardPayments.js`
- Create: `app/src/payments/pelecardPayments.test.js`
- Create: `app/src/pages/PaymentReturn.jsx`
- Create: `app/src/components/cashregister/PaymentScreen.pelecard.test.jsx`
- Modify: `app/src/components/cashregister/PaymentScreen.jsx`
- Modify: `app/src/pages/CashRegister.jsx`
- Modify: `app/src/App.jsx`

- [ ] **Step 1: Write failing frontend tests**

Assert that the existing `אשראי` key calls the existing `onConfirm` handler and is labeled as externally processed, while the new `פלאקארד` choice calls `onPelecard`. Assert initiation redirects only to the returned HTTPS Pelecard URL and repeated return-page polling never writes sales or orders.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run src/payments/pelecardPayments.test.js src/components/cashregister/PaymentScreen.pelecard.test.jsx --maxWorkers=1`  
Expected: FAIL because the new module/choice does not exist.

- [ ] **Step 3: Implement the minimal frontend flow**

Keep `handlePaymentConfirm` unchanged for manual methods. Add a separate `handlePelecardStart` that stores only the local payment ID/idempotency key and redirects to the allowlisted hosted URL. Add `/payment/return` under the authenticated routes and poll `pelecard-status` until a terminal local state is returned.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
npm test -- --run src/payments/pelecardPayments.test.js src/components/cashregister/PaymentScreen.pelecard.test.jsx --maxWorkers=1
git add app/src/payments app/src/pages/PaymentReturn.jsx app/src/components/cashregister/PaymentScreen.jsx app/src/pages/CashRegister.jsx app/src/App.jsx
git commit -m "feat: add hosted Pelecard checkout UI"
```

## Phase 5 — Verification and Handoff

### Task 9: Run the complete mock/sandbox-ready verification

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Run all provider and database tests**

```powershell
npm test --prefix app -- --run src/payments/edge --maxWorkers=1
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pelecard_atomic_finalization.sql
```

Expected: all tests pass against mocked provider responses and a disposable database.

- [ ] **Step 2: Run frontend tests sequentially**

```powershell
$tests = rg --files app/src -g '*.test.js' -g '*.test.jsx'
foreach ($test in $tests) { npm test --prefix app -- --run $test --maxWorkers=1 }
```

Expected: every test file exits 0. Sequential execution avoids the established parallel jsdom timeout baseline.

- [ ] **Step 3: Run build, lint, sensitive-data, and diff gates**

```powershell
npm run build --prefix app
npm run lint --prefix app
rg -n -i "pan|cvv|card.?number|card.?expiry|expiry.?date|pelecard_password|pelecard_user" supabase app/src --glob '!**/*.md'
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: build passes; lint is reported against its existing baseline; sensitive-data search finds only explicit rejection/allowlist tests and environment-variable names, never values or persisted/logged fields; diff check exits 0.

- [ ] **Step 4: Update progress and commit verification notes**

Record files, tests, environment limitations, undeployed status, capabilities awaiting confirmation, sandbox callback requirements, production prerequisites, and the untouched original worktree.

```powershell
git add PROGRESS.md
git commit -m "docs: record Pelecard payment verification"
```

## Real Sandbox Callback Requirements

Before provider-network testing, obtain a Pelecard test terminal/account enabled for IFrame/Redirect 2.0 J4, transaction lookup, server-side feedback, ValidateByUniqueKey, and 3DS test behavior. Provision a non-production Supabase project with public HTTPS callback URLs, apply migrations there, deploy the functions there, and set only Edge secrets: `PELECARD_TERMINAL`, `PELECARD_USER`, `PELECARD_PASSWORD`, `PELECARD_BASE_URL`, `PAYMENTS_APP_BASE_URL`, and `PELECARD_REFUND_ENABLED=false`. Obtain Pelecard's approved test cards/error simulations and verify both browser return and server callback delivery.

## Production Prerequisites

Require explicit approval, backup and rollback runbook, confirmed IFrame/Redirect 2.0 J4 and authoritative lookup access, completed EMV/3DS merchant registration, confirmed cancellation/refund semantics, production HTTPS return/callback domains, production Edge secrets, RLS/finalizer security review, monitoring and reconciliation alerts, and an approved low-value live test. Rivhit remains disconnected.
