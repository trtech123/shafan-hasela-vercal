# Clubs Confirmed Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the confirmed payer, monthly billing, enrollment, cancellation, debt-notification, and participant payment-indicator rules without adding iCredit-to-Rivhit or freeze behavior.

**Architecture:** Pure club-domain date/state helpers define day-15 and cancellation rules. Additive migration 028 preserves legacy rows while enforcing new paths, stores scheduled cancellation/notification work durably, and extends existing verified iCredit reconciliation. Existing Edge Functions remain provider boundaries; the Clubs UI only invokes protected server operations and derives indicators from billing state.

**Tech Stack:** PostgreSQL/Supabase RLS and RPCs, Supabase Edge Functions (Deno TypeScript), React/Vite, Vitest.

---

### Task 1: Club business-rule domain

**Files:**
- Modify: `app/src/lib/clubDomain.test.js`
- Modify: `app/src/lib/clubDomain.js`

- [ ] **Step 1: Write failing domain tests**

Cover payer and participant names differing, payer contact/billing identity normalization, fixed `CLUB_BILLING_DAY=15`, participation date versus first-of-next-month recurring start, no proration marker, cancellation requested on day 10/day 11, December/year boundary, and real-state payment indicator.

- [ ] **Step 2: Prove RED**

Run `npm test --prefix app -- src/lib/clubDomain.test.js`; expect failures for the new exports/behavior.

- [ ] **Step 3: Implement minimal pure helpers**

Provide:

```js
export const CLUB_BILLING_DAY = 15;
export function nextRecurringStart(joinDate) {
  const [year, month] = joinDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 10);
}
export function calculateCancellationPeriod(requestDate) {
  const [year, month, day] = requestDate.split("-").map(Number);
  const monthsAhead = day <= 10 ? 1 : 2;
  const effective = new Date(Date.UTC(year, month - 1 + monthsAhead, 1));
  const end = new Date(Date.UTC(
    effective.getUTCFullYear(),
    effective.getUTCMonth(),
    0,
  ));
  return {
    effectiveOn: effective.toISOString().slice(0, 10),
    endsOn: end.toISOString().slice(0, 10),
  };
}
export function clubPaymentIndicator(membership) {
  const settled = membership.payment_status === "current"
    && Number(membership.debt_amount || 0) === 0;
  return { settled, label: settled ? "מוסדר" : "לא מוסדר" };
}
```

`buildMembershipRegistration` must output participant plus membership with `starts_on`, `recurring_starts_on`, billing day 15, and payer billing identity. It must not calculate a prorated amount.

- [ ] **Step 4: Prove GREEN and commit**

Run domain tests; commit as `feat(clubs): define confirmed billing rules`.

### Task 2: Additive Clubs schema and reconciliation contracts

**Files:**
- Create: `supabase/migrations/028_clubs_confirmed_business_rules.sql`
- Modify: `app/src/lib/clubsMigrationContract.test.js`
- Modify: `app/src/lib/icreditReconciliation.test.js`

- [ ] **Step 1: Write failing migration/reconciliation tests**

Assert additive billing identity/recurring start fields, new/pending day-15 normalization without rewriting active provider agreements, new-write day-15 enforcement, scheduled cancellation jobs with leases/fencing, notification outbox uniqueness on `(recurring_charge_id, purpose)`, admin read/no browser write RLS, one notification created only when final charge state is failed, and no accounting/Rivhit trigger for iCredit.

- [ ] **Step 2: Prove RED, then implement migration 028**

Add columns `billing_identity_name`, `billing_identity_number`, and `recurring_starts_on`. Backfill `recurring_starts_on=starts_on` for legacy rows; normalize clubs and memberships without active provider agreement to day 15; retain active provider day as recorded.

Create `club_cancellation_jobs` and `club_payment_notifications`, service-only claim/complete/fail RPCs with attempt/lease fencing, and admin SELECT RLS. Replace the enrollment preparation RPC so all new agreements use day 15 and `recurring_starts_on`. Replace the recurring-event RPC without weakening its current digest/idempotency/debt protections and insert notification intent using `ON CONFLICT DO NOTHING` after the effective charge state is confirmed failed.

- [ ] **Step 3: Run contracts and commit**

Run migration and reconciliation tests; commit as `feat(clubs): persist confirmed billing lifecycle`.

### Task 3: Payer-first enrollment and no-proration UI

**Files:**
- Modify: `app/src/components/clubs/MemberRegistrationDialog.jsx`
- Modify: `app/src/components/clubs/ClubFormDialog.jsx`
- Modify: `app/src/components/clubs/ClubForms.test.jsx`
- Modify: `supabase/functions/club-recurring-enroll/index.ts`
- Modify: `supabase/functions/_shared/icredit.ts`
- Modify: `app/src/lib/icreditProvider.test.js`

- [ ] **Step 1: Write failing form/provider tests**

Assert the dialog has distinct `פרטי משתתף / ילד` and `פרטי הורה / משלם` groups, payer billing fields, a fixed non-editable day-15 explanation, joining-month cashier/no-proration text, calculated recurring start, and iCredit customer fields sourced from payer with legacy fallback. Keep `RecurringSaleProRata: false`.

- [ ] **Step 2: Implement forms and provider mapping**

Remove arbitrary billing-day inputs. Pass day 15 server-side regardless of browser payload. Send payer/contact name, phone, and email to iCredit; child identity remains participant data. No card/token fields are stored.

- [ ] **Step 3: Run focused tests and commit**

Run form, domain, iCredit provider, enrollment, and migration contracts. Commit as `feat(clubs): separate payer and participant enrollment`.

### Task 4: Scheduled provider-first cancellation

**Files:**
- Modify: `supabase/functions/club-recurring-cancel/index.ts`
- Create: `supabase/functions/club-recurring-cancel/handler.ts`
- Create: `supabase/functions/club-recurring-cancel/handler.test.ts`
- Create: `supabase/functions/club-cancellation-worker/index.ts`
- Create: `supabase/functions/club-cancellation-worker/handler.ts`
- Create: `supabase/functions/club-cancellation-worker/handler.test.ts`

- [ ] **Step 1: Write failing schedule/worker tests**

Prove the request endpoint persists the server-calculated period without calling iCredit immediately. Prove the due worker claims one eligible job, calls provider first, finalizes locally only after provider confirmation, fences duplicate workers, retries explicit provider rejection safely, and marks ambiguous outcomes for reconciliation.

- [ ] **Step 2: Implement request and due worker**

The request accepts only `membershipId`; date calculation occurs in the service-role RPC. The due worker accepts only a job ID or claims the next due row, loads provider identifiers server-side, calls existing `cancelRecurringSale`, then uses fenced completion/failure RPCs. It never changes charge/debt history.

- [ ] **Step 3: Run focused tests and commit**

Run cancellation, iCredit and migration tests. Commit as `feat(clubs): schedule provider-first cancellations`.

### Task 5: Clubs operator visibility and payment indicator

**Files:**
- Modify: `app/src/pages/Clubs.jsx`
- Modify: `app/src/pages/Clubs.test.jsx`

- [ ] **Step 1: Write failing page tests**

Assert payer versus child display, fixed day 15 and recurring start, day-10/day-11 cancellation preview, scheduled result (not immediate cancellation), failed-charge/debt and notification state visibility, green `✓ מוסדר`, red `✕ לא מוסדר`, and absence of freeze controls.

- [ ] **Step 2: Implement the UI**

Load memberships with payer/recurring fields plus recent charge/notification state. Use `calculateCancellationPeriod` for preview and let the server return the authoritative date. Replace immediate browser cancellation writes with the Edge Function. Add a dedicated payment column/card indicator derived from `clubPaymentIndicator`; do not add a cosmetic flag.

- [ ] **Step 3: Run focused UI tests and commit**

Run Clubs page/form/domain tests and focused lint/type diagnostics. Commit as `feat(clubs): expose payment and cancellation state`.

### Task 6: Clubs verification

- [ ] Run all Clubs/iCredit tests, migration contracts, full app suite, build, focused lint, touched-file TypeScript checks, and `git diff --check`.
- [ ] Grep for `RecurringSaleProRata: false`, day 15 enforcement, and absence of iCredit-to-Rivhit orchestration/freeze calls.
- [ ] Record exact evidence and the external Meta template/scheduler/provider activation blockers in `PROGRESS.md`.
- [ ] Commit verification documentation as `docs: record confirmed clubs rules verification`.
