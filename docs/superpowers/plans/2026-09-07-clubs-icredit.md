# Clubs and iCredit Recurring Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an admin-only Clubs/Membership domain and TEST-only hosted iCredit recurring billing with verified, idempotent reconciliation and immediate provider-first cancellation.

**Architecture:** Add an isolated normalized Clubs schema and atomic billing RPCs in one additive migration. Keep iCredit HTTP and IPN normalization in a pure shared adapter tested under Vitest, while three Supabase Edge Functions provide authenticated enrollment/cancellation and a public-but-verified IPN boundary. Add one RTL master/detail Clubs page with focused edit/registration dialogs.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Supabase Edge Functions (Deno/TypeScript), React 18, Vite, Vitest, Testing Library, iCredit `GetUrl`/`Verify`/`RecurringSaleCancel` TEST APIs.

---

## File structure

- `supabase/migrations/021_clubs_and_recurring_billing.sql`: additive tables, constraints, indexes, RLS, grants and atomic billing functions.
- `supabase/functions/_shared/icredit.ts`: pure provider payload, response, IPN normalization, sanitization and digest helpers.
- `supabase/functions/_shared/admin.ts`: reusable JWT/admin authorization for the two authenticated billing functions.
- `supabase/functions/club-recurring-enroll/index.ts`: validate admin and membership, create/reuse agreement, call TEST GetUrl.
- `supabase/functions/club-recurring-ipn/index.ts`: public IPN parsing, local expectation lookup, provider Verify, atomic reconciliation.
- `supabase/functions/club-recurring-cancel/index.ts`: provider-first TEST cancellation, then atomic local cancellation.
- `app/src/lib/clubDomain.js`: form normalization, schedule validation and safe billing-display helpers.
- `app/src/pages/Clubs.jsx`: admin Clubs master/detail data orchestration.
- `app/src/components/clubs/ClubFormDialog.jsx`: create/edit club and multiple weekly schedule rules.
- `app/src/components/clubs/MemberRegistrationDialog.jsx`: participant and snapshotted membership registration.
- `app/src/App.jsx`: `/clubs` route.
- `app/src/components/Layout.jsx`: admin-only Clubs navigation item.
- `app/src/lib/clubsMigrationContract.test.js`: schema/RLS/uniqueness/atomic-function contract.
- `app/src/lib/clubDomain.test.js`: schedule and price-snapshot helpers.
- `app/src/lib/icreditProvider.test.js`: shared adapter contract.
- `app/src/lib/icreditReconciliation.test.js`: reconciliation-model cases matching the database function.
- `app/src/pages/Clubs.test.jsx`: page/dialog interactions and authorization-visible contract.
- `docs/icredit-clubs-operations.md`: TEST findings, configuration, production gate and non-document requirements.
- `PROGRESS.md`: completion record only after verification.

### Task 1: Additive schema and database invariants

**Files:**
- Create: `app/src/lib/clubsMigrationContract.test.js`
- Create: `supabase/migrations/021_clubs_and_recurring_billing.sql`

- [ ] **Step 1: Write the failing migration contract test**

Read migration `021` with Node `fs` and assert all nine `CREATE TABLE` statements, `ENABLE ROW LEVEL SECURITY`, unique provider keys, admin-only policies, revoked browser mutation rights, and the functions `process_icredit_recurring_event`/`cancel_icredit_recurring_membership` exist.

```js
const requiredTables = [
  'clubs', 'club_schedule_rules', 'club_sessions', 'club_participants',
  'club_memberships', 'recurring_agreements', 'recurring_charges',
  'club_attendance', 'payment_webhook_events',
];
for (const table of requiredTables) {
  expect(sql).toMatch(new RegExp(`CREATE TABLE public\\.${table}\\b`, 'i'));
  expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'));
}
expect(sql).toContain('UNIQUE (provider, provider_recurring_id)');
expect(sql).toContain('UNIQUE (provider, provider_sale_id)');
expect(sql).toContain('UNIQUE (agreement_id, provider_charge_number)');
expect(sql).toContain('event_digest TEXT NOT NULL UNIQUE');
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/lib/clubsMigrationContract.test.js --pool=threads --maxWorkers=1`  
Expected: FAIL because migration `021` does not exist.

- [ ] **Step 3: Implement migration**

Create the nine tables and validation constraints described in the approved spec. Add partial uniqueness for one open membership per participant/club. Make agreement/charge/webhook browser reads admin-only and writes service-role-only. Implement one atomic event function that:

```sql
INSERT INTO public.payment_webhook_events (...) VALUES (...)
ON CONFLICT (event_digest) DO NOTHING;
-- return duplicate without mutation when not inserted
-- charge_number = 0: link/activate agreement
-- charge_number > 0: upsert the stable agreement+charge-number row
-- recompute debt strictly from status = 'failed'
SELECT COALESCE(SUM(amount), 0) INTO v_debt
FROM public.recurring_charges
WHERE agreement_id = p_agreement_id AND status = 'failed';
```

`cancel_icredit_recurring_membership` updates agreement and membership only after the Edge Function has a provider success response. Revoke both RPCs from `PUBLIC`, `anon`, and `authenticated`; grant to `service_role`.

- [ ] **Step 4: Verify GREEN**

Run the focused migration contract test and `git diff --check`. Expected: PASS and no whitespace errors.

- [ ] **Step 5: Commit**

```powershell
git add app/src/lib/clubsMigrationContract.test.js supabase/migrations/021_clubs_and_recurring_billing.sql
git commit -m "feat: add clubs membership schema"
```

### Task 2: Pure iCredit TEST adapter and reconciliation model

**Files:**
- Create: `app/src/lib/icreditProvider.test.js`
- Create: `app/src/lib/icreditReconciliation.test.js`
- Create: `supabase/functions/_shared/icredit.ts`

- [ ] **Step 1: Write failing provider tests**

Assert `buildEnrollmentRequest()` uses the TEST endpoint contract and exact recurring values, includes only safe customer/contact data, and omits document/receipt and card/token fields. Assert `normalizeIpn()` rejects malformed UUID/amount/charge values and drops PAN/CVV/expiry/token/raw payload fields. Assert `verifyIpn()` commits nothing when the injected Verify request does not return `Verified`. Assert cancellation accepts only `{Status: 0}`.

```js
expect(payload).toMatchObject({
  CreateRecurringSale: true,
  SaleType: 2,
  RecurringSaleCycle: 3,
  RecurringSaleStep: 1,
  RecurringSaleCount: 0,
  RecurringSaleAutoCharge: true,
  RecurringSaleProRata: false,
  IPNMethod: 1,
});
for (const key of ['DocumentType', 'ReceiptType', 'CreditcardToken', 'TransactionToken']) {
  expect(payload).not.toHaveProperty(key);
}
```

- [ ] **Step 2: Verify RED**

Run both focused tests. Expected: FAIL because the shared adapter does not exist.

- [ ] **Step 3: Implement the minimal adapter**

Export constants for TEST endpoints, request/response validators, allow-listed IPN normalization, SHA-256 digest generation and safe error creation. Accept `fetch` as a dependency so tests never contact iCredit. Never log request bodies.

- [ ] **Step 4: Add reconciliation-model tests**

Use a small in-memory model matching the SQL invariants to prove: duplicate event no-op; failed charge creates debt; same charge-number success resolves it; a later successful charge leaves the older debt.

- [ ] **Step 5: Verify GREEN and commit**

Run focused tests, then commit:

```powershell
git add app/src/lib/icreditProvider.test.js app/src/lib/icreditReconciliation.test.js supabase/functions/_shared/icredit.ts
git commit -m "feat: add icredit recurring adapter"
```

### Task 3: Enrollment, verified IPN and provider-first cancellation functions

**Files:**
- Create: `supabase/functions/_shared/admin.ts`
- Create: `supabase/functions/club-recurring-enroll/index.ts`
- Create: `supabase/functions/club-recurring-ipn/index.ts`
- Create: `supabase/functions/club-recurring-cancel/index.ts`
- Extend: `app/src/lib/icreditProvider.test.js`

- [ ] **Step 1: Write failing function-boundary tests**

Static/import tests assert enrollment and cancellation require Authorization/admin, IPN does not trust payload status, all provider URLs come from the TEST adapter, and secrets are read only from `Deno.env`.

- [ ] **Step 2: Verify RED**

Run the focused provider test. Expected: FAIL because the Edge Functions are absent.

- [ ] **Step 3: Implement enrollment**

Authenticate caller, require admin, load membership/club/participant, create or reuse one pending agreement, build a GetUrl request using server-only `ICREDIT_GROUP_PRIVATE_TOKEN`, require configured HTTPS redirect/IPN URLs, call TEST, persist safe response references, and return only `{ok, agreementId, url}`.

- [ ] **Step 4: Implement IPN**

Accept POST form or JSON, normalize allow-listed fields, resolve agreement by random `Custom1`, load expected price, require matching GroupPrivateToken and linked RecurringId, call official Verify using expected local amount, then invoke `process_icredit_recurring_event`. Never log/store raw input.

- [ ] **Step 5: Implement cancellation**

Authenticate admin, load active agreement, call TEST `RecurringSaleCancel`, explicitly return provider failure without local mutation, and invoke `cancel_icredit_recurring_membership` only for `Status=0`.

- [ ] **Step 6: Verify and commit**

Run provider/reconciliation tests and `git diff --check`, then commit the Edge Functions.

### Task 4: Club-domain helpers and form dialogs

**Files:**
- Create: `app/src/lib/clubDomain.test.js`
- Create: `app/src/lib/clubDomain.js`
- Create: `app/src/components/clubs/ClubFormDialog.jsx`
- Create: `app/src/components/clubs/MemberRegistrationDialog.jsx`

- [ ] **Step 1: Write failing domain-helper tests**

Assert multiple schedule rules normalize independently, invalid end-before-start is rejected, registration defaults copy the club price/billing day, and later club edits do not mutate the membership snapshot.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/lib/clubDomain.test.js --pool=threads --maxWorkers=1`. Expected: FAIL because the helper is missing.

- [ ] **Step 3: Implement helpers and verify GREEN**

Implement `validateScheduleRules`, `normalizeClubPayload`, and `buildMembershipRegistration` with no provider knowledge. Run the focused test.

- [ ] **Step 4: Implement dialogs**

Use existing shadcn components and direct Supabase calls. Club save inserts/updates the club then replaces its rules only after validation. Registration inserts participant then membership using the helper's explicit `monthly_price` snapshot.

- [ ] **Step 5: Commit**

Commit helpers/tests/dialogs as `feat: add club admin forms`.

### Task 5: Admin Clubs workspace and route

**Files:**
- Create: `app/src/pages/Clubs.test.jsx`
- Create: `app/src/pages/Clubs.jsx`
- Modify: `app/src/App.jsx`
- Modify: `app/src/components/Layout.jsx`

- [ ] **Step 1: Write failing UI tests**

Mock Supabase at the boundary and assert the page renders club/instructor/schedule/member/billing data; opens create/edit and registration dialogs; calls `club-recurring-enroll`; opens only a `https://testicredit.rivhit.co.il/` URL; surfaces cancellation failure without locally changing status; reloads after cancellation success.

- [ ] **Step 2: Verify RED**

Run the focused UI test. Expected: FAIL because the page/route are missing.

- [ ] **Step 3: Implement the page**

Create the admin master/detail workspace from the action map. Keep payment/debt badges descriptive and avoid exposing provider-private data. Add the admin-only nav item and route.

- [ ] **Step 4: Verify GREEN and commit**

Run UI/domain/provider tests and commit as `feat: add clubs admin workspace`.

### Task 6: TEST configuration inspection and operational runbook

**Files:**
- Create: `docs/icredit-clubs-operations.md`

- [ ] **Step 1: Inspect official TEST dashboard/page settings**

Use the published TEST management credentials from the official documentation. Record whether the shared Hebrew test payment page has recurring sales enabled and whether automatic document/receipt generation is disabled. Do not alter the shared page. If the setting is not visible or verifiable, record that limitation exactly.

- [ ] **Step 2: Perform a non-card GetUrl contract smoke test only if safe**

Call TEST GetUrl using the official public test identifier and non-personal data only. Do not submit the hosted page, enter a test card, or activate a recurring agreement. Record status and response shape; never commit returned private/public tokens or URLs.

- [ ] **Step 3: Write the runbook**

Document Edge Function secrets/URLs, JWT exception for IPN, TEST limitations, payment-page no-document requirement, webhook Verify behavior, recurring terminal/module/SHVA/J5/3DS requirements, Production page ID and missing client decisions.

- [ ] **Step 4: Commit**

Commit as `docs: add icredit clubs operations runbook`.

### Task 7: Full verification and completion record

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Run focused and full tests**

```powershell
npx vitest run src/lib/clubsMigrationContract.test.js src/lib/clubDomain.test.js src/lib/icreditProvider.test.js src/lib/icreditReconciliation.test.js src/pages/Clubs.test.jsx --pool=threads --maxWorkers=1
npm test -- --pool=threads --maxWorkers=1
npm run build
npm run lint
```

Expected: all feature/full tests and build pass. Lint may contain only the exact ten baseline errors; any new error must be fixed.

- [ ] **Step 2: Security scans**

Search new source for PAN-like test numbers, token-field persistence/logging, Production URLs, accounting endpoints, and direct card fields. Confirm browser code contains no iCredit credentials.

- [ ] **Step 3: Update PROGRESS and commit**

Record files, tests, limitations, no deployment/application, and Production/client gates. Commit as `docs: record clubs billing verification`.

- [ ] **Step 4: Verify branch isolation**

Compare the original main worktree status with the captured initial status and confirm quotation changes remain untouched. Report commits and working-tree state.
