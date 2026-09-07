# Rivhit Accounting Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove a standalone server-side Rivhit customer/document workflow with additive accounting state, two-layer idempotency, and configurable document behavior.

**Architecture:** Two generic Supabase tables hold customer and document state. Small shared TypeScript modules isolate Rivhit HTTP behavior, source mapping, orchestration, and persistence; a JWT-protected Edge Function composes them. Tests execute the core with deterministic repositories, while a file-backed harness proves the same workflow against Rivhit's shared sandbox without touching Production Supabase.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Supabase Edge Functions (Deno/TypeScript), standard Fetch/Web Crypto APIs, Vitest, Node 24 sandbox harness.

---

### Task 1: Add the accounting ledger migration

**Files:**
- Create: `supabase/migrations/021_rivhit_accounting.sql`
- Create: `supabase/functions/_shared/rivhit/migration.test.ts`

- [ ] **Step 1: Write the failing migration contract test**

Create a Vitest test that reads `021_rivhit_accounting.sql` and asserts both table definitions, the customer/document uniqueness constraints, the document customer FK index, RLS enablement and read policies, atomic claim functions, execute revocation from `public`/`anon`/`authenticated`, and grant to `service_role`. Also assert that the SQL contains no `ALTER TABLE public.orders` or `ALTER TABLE public.sales` statement.

```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const sql = readFileSync(new URL("../../../migrations/021_rivhit_accounting.sql", import.meta.url), "utf8");

describe("021 Rivhit accounting migration", () => {
  test("is additive and creates the generic ledger", () => {
    expect(sql).toContain("CREATE TABLE public.accounting_customers");
    expect(sql).toContain("CREATE TABLE public.accounting_documents");
    expect(sql).not.toMatch(/ALTER TABLE public\.(orders|sales)\s+(ADD|DROP|ALTER)/i);
  });

  test("enforces idempotency and service-only claims", () => {
    expect(sql).toContain("UNIQUE (provider, identity_key)");
    expect(sql).toContain("UNIQUE (provider, source_type, source_id, document_type_key)");
    expect(sql).toContain("UNIQUE (provider, request_reference)");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.claim_accounting_customer");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.claim_accounting_document");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO service_role/i);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm exec --prefix app vitest -- run --root .. supabase/functions/_shared/rivhit/migration.test.ts`
Expected: FAIL because `021_rivhit_accounting.sql` does not exist.

- [ ] **Step 3: Implement the additive schema**

Create the two tables and their constraints/indexes/RLS exactly as specified in the design. Add `updated_at` triggers using the existing `public.update_updated_at()` helper. Implement `claim_accounting_customer` and `claim_accounting_document` as short PL/pgSQL functions that insert with `ON CONFLICT DO NOTHING`, lock only the ledger row, reject payload hash changes, and reclaim only due retry/stale processing states. Use `SECURITY DEFINER SET search_path = ''`; revoke default execution and grant only to `service_role`.

The customer claim returns:

```sql
TABLE (
  id uuid,
  status text,
  external_customer_id text,
  claimed boolean,
  attempt_count integer
)
```

The document claim returns:

```sql
TABLE (
  id uuid,
  status text,
  external_document_id text,
  external_document_number text,
  document_url text,
  claimed boolean,
  attempt_count integer
)
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm exec --prefix app vitest -- run --root .. supabase/functions/_shared/rivhit/migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Check migration formatting and commit**

Run: `git diff --check`
Expected: exit 0.

Commit:

```powershell
git add supabase/migrations/021_rivhit_accounting.sql supabase/functions/_shared/rivhit/migration.test.ts
git commit -m "feat: add external accounting ledger"
```

### Task 2: Implement configuration, order mapping, and the Rivhit client

**Files:**
- Create: `supabase/functions/_shared/rivhit/types.ts`
- Create: `supabase/functions/_shared/rivhit/config.ts`
- Create: `supabase/functions/_shared/rivhit/order-mapper.ts`
- Create: `supabase/functions/_shared/rivhit/client.ts`
- Create: `supabase/functions/_shared/rivhit/config.test.ts`
- Create: `supabase/functions/_shared/rivhit/order-mapper.test.ts`
- Create: `supabase/functions/_shared/rivhit/client.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Cover missing JSON, missing mapping keys, invalid document types, and a valid complete mapping. The public API is:

```ts
export function parseDocumentTypeMap(raw: string | undefined): Record<string, DocumentMapping>;
export function getDocumentMapping(map: Record<string, DocumentMapping>, key: string): DocumentMapping;
```

Run: `npm exec --prefix app vitest -- run --root .. supabase/functions/_shared/rivhit/config.test.ts`
Expected: FAIL because `config.ts` does not exist.

- [ ] **Step 2: Implement and verify configuration GREEN**

`DocumentMapping` requires integer `document_type` in 1..999, integer `sort_code` in 0..999, integer `currency_id` in 1..10, and boolean `price_include_vat`, `send_mail`, and `digital_signature`. Reject unknown/malformed entries with messages that never contain environment values.

Run the configuration test again. Expected: PASS.

- [ ] **Step 3: Write failing order adapter tests**

Test institutional/customer-name priority, identity priority, PII hashing, stable `acc_ref` length, item construction, order-number truncation, and stable request/payload hashes. The API is:

```ts
export async function mapOrderToAccountingSource(
  order: OrderSource,
  activityName: string | null,
  documentTypeKey: string,
  mapping: DocumentMapping,
): Promise<MappedAccountingSource>;
```

Run the order adapter test. Expected: FAIL because `order-mapper.ts` does not exist.

- [ ] **Step 4: Implement and verify order adapter GREEN**

Use Web Crypto SHA-256 and a recursive stable-key JSON serializer. Store only the digest as `identityKey`; generate `externalReference` as `sh${digest.slice(0, 18)}`. Build a one-item Rivhit request, omit raw ID/VAT fields, and include `prevent_duplicates: true` with a stable request reference.

Run the order adapter test again. Expected: PASS.

- [ ] **Step 5: Write failing HTTP client tests**

Inject `fetch` and cover:

```ts
const client = new RivhitClient({ apiToken: "server-secret", fetchImpl });
await client.findCustomerByAccRef("sh123");
await client.createCustomer(customerRequest);
await client.createDocument(documentRequest);
```

Assert customer found/not-found behavior, customer creation, document response parsing, network retry classification, 408/429/5xx retry classification, 4xx permanence, nonzero Rivhit errors, malformed JSON, and missing success fields. Assert captured request bodies contain the token while returned/loggable errors never do.

Run the client test. Expected: FAIL because `client.ts` does not exist.

- [ ] **Step 6: Implement and verify HTTP client GREEN**

POST JSON to the three official `.svc` endpoints. Parse JSON on both success and failure statuses. Treat Rivhit `-2` from `Customer.Get` as not found; require `customer_id` on customer success and document identity/number/link/customer ID on document success. Model errors with:

```ts
export class RivhitError extends Error {
  retryable: boolean;
  reconciliationRequired: boolean;
  httpStatus: number | null;
  errorCode: number | null;
  clientMessage: string | null;
  debugMessage: string | null;
}
```

Run all Task 2 tests. Expected: PASS.

- [ ] **Step 7: Commit the connector boundary**

Run `git diff --check`, then commit:

```powershell
git add supabase/functions/_shared/rivhit
git commit -m "feat: add Rivhit connector and order mapping"
```

### Task 3: Implement idempotent workflow and Supabase persistence

**Files:**
- Create: `supabase/functions/_shared/rivhit/workflow.ts`
- Create: `supabase/functions/_shared/rivhit/workflow.test.ts`
- Create: `supabase/functions/_shared/rivhit/supabase-repository.ts`
- Create: `supabase/functions/_shared/rivhit/supabase-repository.test.ts`

- [ ] **Step 1: Write failing workflow tests**

Build an in-memory repository implementing this interface:

```ts
export interface AccountingRepository {
  claimCustomer(input: ClaimCustomerInput): Promise<CustomerClaim>;
  succeedCustomer(id: string, externalCustomerId: string): Promise<void>;
  failCustomer(id: string, failure: PersistedFailure): Promise<void>;
  claimDocument(input: ClaimDocumentInput): Promise<DocumentClaim>;
  succeedDocument(id: string, result: RivhitDocumentResult): Promise<void>;
  failDocument(id: string, failure: PersistedFailure): Promise<void>;
}
```

Tests must cover found customer, created customer, persisted customer ID, created/persisted document, duplicate success without another API call, active processing, retry not due, retry after due, network error persistence, permanent response persistence, and reconciliation-required persistence.

Run: `npm exec --prefix app vitest -- run --root .. supabase/functions/_shared/rivhit/workflow.test.ts`
Expected: FAIL because `workflow.ts` does not exist.

- [ ] **Step 2: Implement and verify workflow GREEN**

Implement `runRivhitAccounting` with dependency injection for repository, client, and clock. Claim before every external action. Persist every success/error before returning or throwing. Return a discriminated result:

```ts
type WorkflowResult =
  | { status: "succeeded"; duplicate: boolean; customerId: string; documentId: string; documentNumber: string; documentUrl: string }
  | { status: "processing" | "retryable_error"; duplicate: true; retryAfter: string | null };
```

Run workflow tests. Expected: PASS.

- [ ] **Step 3: Write failing Supabase repository tests**

Use a recording fake Supabase client. Assert exact RPC names/arguments and exact table updates for every claim/success/failure operation. Assert raw API tokens and source PII are never written.

Run the repository test. Expected: FAIL because `supabase-repository.ts` does not exist.

- [ ] **Step 4: Implement and verify repository GREEN**

Implement only the RPC/update calls required by `AccountingRepository`; normalize Supabase errors and `.single()` results. Do not add generic service wrappers.

Run Task 3 tests. Expected: PASS.

- [ ] **Step 5: Commit workflow and persistence**

Run `git diff --check`, then commit:

```powershell
git add supabase/functions/_shared/rivhit
git commit -m "feat: orchestrate idempotent Rivhit accounting"
```

### Task 4: Add the protected Edge Function and live sandbox harness

**Files:**
- Create: `supabase/functions/rivhit-accounting/index.ts`
- Create: `supabase/functions/rivhit-accounting/index.contract.test.ts`
- Create: `scripts/rivhit/file-repository.ts`
- Create: `scripts/verify-rivhit-sandbox.ts`
- Modify: `.gitignore`
- Modify: `PROGRESS.md`

- [ ] **Step 1: Write the failing Edge Function contract test**

Read `index.ts` as text and assert it reads `RIVHIT_API_TOKEN`, `RIVHIT_DOCUMENT_TYPE_MAP`, and `RIVHIT_ACCOUNTING_MODE`; authenticates through `auth.getUser`; authorizes only `admin`/`operations`; loads orders server-side; never reads a token from request JSON; and composes `RivhitClient`, `SupabaseAccountingRepository`, and `runRivhitAccounting`.

Run the contract test. Expected: FAIL because the function does not exist.

- [ ] **Step 2: Implement and verify the Edge Function**

Support `OPTIONS` and `POST`; reject all other methods. Require a JWT, validate a UUID `sourceId`, require `sourceType` to equal `order`, require a nonempty `documentTypeKey`, and refuse any mode other than `sandbox` or `production`. The mode only labels/safeguards configuration; the token selects the Rivhit account. Load order/activity via the service client after caller authorization. Return 200 for success/duplicate success, 202 for in-progress/retry-not-due, 400 for input/config errors, 401/403 for auth failures, 409 for permanent/reconciliation failures, and 502/503 for provider failures. Never serialize secrets.

Run the contract test. Expected: PASS.

- [ ] **Step 3: Write the failing file repository tests**

Use a temporary directory. Assert the first instance persists customer/document success and a second instance loads the same state and returns unclaimed succeeded rows. Assert due retry state can be reclaimed and not-due state cannot.

Run the file repository test. Expected: FAIL because `file-repository.ts` does not exist.

- [ ] **Step 4: Implement and verify the file repository**

Use `node:fs/promises`, atomic write-to-temp-and-rename, and the same `AccountingRepository` contract. Store only synthetic sandbox state under `.tmp/rivhit-sandbox-state.json`; add `/.tmp/` to `.gitignore`.

Run the file repository test. Expected: PASS.

- [ ] **Step 5: Implement the live sandbox verifier**

Require `RIVHIT_API_TOKEN` and `RIVHIT_TEST_DOCUMENT_TYPE` from the process environment. Create a synthetic order with a random UUID and synthetic `example.com` email. Configure mail/signature off. Run the core once, reload the file repository, run it again, and assert:

```ts
first.status === "succeeded";
first.documentId && first.documentNumber && first.documentUrl;
second.status === "succeeded" && second.duplicate === true;
documentNewCallsAfterSecond === documentNewCallsAfterFirst;
```

Print only non-secret IDs, link, request counts, and proof assertions.

- [ ] **Step 6: Update progress documentation**

Document the additive migration, new Edge Function, tests, no Production application/deployment, sandbox proof command, local Docker limitation, and all still-open accounting decisions. Explicitly state that `RCP-*` receipts remain local and unrelated.

- [ ] **Step 7: Run automated verification and commit**

Run:

```powershell
npm exec --prefix app vitest -- run --root .. supabase/functions/_shared/rivhit supabase/functions/rivhit-accounting scripts/rivhit
npm test --prefix app
npm run build --prefix app
git diff --check
```

Expected: all Rivhit tests and the existing 9-test baseline pass; build exits 0.

Commit:

```powershell
git add .gitignore PROGRESS.md scripts/rivhit scripts/verify-rivhit-sandbox.ts supabase/functions/rivhit-accounting
git commit -m "feat: expose protected Rivhit accounting flow"
```

### Task 5: Run the live sandbox proof and final audit

**Files:**
- No committed file required; `.tmp/` contains ignored proof state.

- [ ] **Step 1: Validate sandbox document type availability**

Call `Document.TypeList` using the official test token held only in the process environment. Confirm the explicitly selected `RIVHIT_TEST_DOCUMENT_TYPE` exists. Do not infer a Production mapping from this result.

- [ ] **Step 2: Execute the sandbox verifier**

Run:

```powershell
$env:RIVHIT_API_TOKEN=Read-Host 'Paste the official Rivhit sandbox token from the Rivhit test-environment documentation'
$env:RIVHIT_TEST_DOCUMENT_TYPE='1'
node --experimental-strip-types scripts/verify-rivhit-sandbox.ts
Remove-Item Env:RIVHIT_API_TOKEN,Env:RIVHIT_TEST_DOCUMENT_TYPE
```

Expected: customer ID, document identity/number/link, first-run `Document.New` count 1, and second-run count still 1.

- [ ] **Step 3: Run fresh final verification**

Run all Rivhit tests, complete app tests, build, `git diff --check`, `git status --short`, and a scoped grep proving no Pelecard/iCredit files changed and no Rivhit token appears in frontend code.

- [ ] **Step 4: Audit commits and original worktree isolation**

Run `git log --oneline c8a0663..HEAD`, `git diff --stat c8a0663..HEAD`, and `git -C 'C:\Users\nadav\OneDrive\Desktop\dev-projs\shafan-hasela\shafan-hasela-vercal' status --short --branch`. Compare the latter with the recorded original status; do not modify it.
