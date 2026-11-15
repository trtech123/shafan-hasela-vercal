# Physical Order Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept a CT20 payment for an existing scheduled order while preserving the one-shot physical dispatch and accounting hold.

**Architecture:** Add a separate order reservation RPC and order-specific physical finalization branch. Reuse the existing physical intent, provider worker, and browser recovery. Connect to the other branch through its order status RPC and a link from its collection screen; do not edit that screen in this branch.

**Tech Stack:** PostgreSQL/Supabase, Node.js, React/Vitest.

---

### Task 1: Order reservation contract

**Files:** `app/server/pelecard-physical/http.js`, `workflow.js`, `repository.js`, their tests, `supabase/migrations/202611150002_physical_order_collection.sql`.

- [ ] Write tests for `prepareOrder` with an order UUID and requested minor amount, rejection of extra browser fields, and no provider send.
- [ ] Run the focused tests and confirm the new behavior fails.
- [ ] Add `startOrder` and repository `reserveOrder`; derive order facts and balance inside the new RPC under an order row lock. Persist `payment_transactions.order_id`, snapshots, and a request-key uniqueness check. Reject archived/cancelled orders, unresolved attempts, stale balance, and overpayment.
- [ ] Run focused tests and migration contract checks; confirm standalone `prepare` still passes.

### Task 2: Verified order finalization

**Files:** `supabase/migrations/202611150002_physical_order_collection.sql`, `app/server/pelecard-physical/repository.js`, physical repository/workflow tests.

- [ ] Write failing tests for one verified payment and linked sale, partial/full status, idempotent retries, and uncertain recovery without resend.
- [ ] Extend the physical finalizer only for intents with `payment_transactions.order_id`. Keep the digital finalizer unchanged; update the order status after the verified sale according to remaining balance. Set physical Payper hold `order_id` to the payment order ID.
- [ ] Verify focused tests and migration invariants, including the order ledger sum and request-key behavior.

### Task 3: Browser entry and recovery

**Files:** `app/src/pages/PhysicalPayment.jsx`, `PhysicalPayment.test.jsx`, `app/src/payments/physical/client.js` if needed.

- [ ] Write failing UI tests for a `/payment/physical?orderId=<uuid>` entry, full/partial amount selection, order billing/status load, and reload recovery by request key.
- [ ] Implement order mode using the shared `get_payper_order_collection` response. Send `prepareOrder` and no cart price. Keep standalone mode unchanged.
- [ ] Verify UI tests and the physical HTTP tests.

### Task 4: Cross-branch and release verification

**Files:** release documentation only.

- [ ] Review the second branch's current `202611150001` migration and order collection UI contract; record its required link and integration order. Do not copy uncommitted work.
- [ ] Run physical, digital payment regression, and production build tests.
- [ ] Confirm physical flags off, commit and push this branch. Do not apply `202611150002` or deploy the incomplete combined release.
