# Physical Cloud Terminal Implementation Plan

**Goal:** Add a separately gated card-present POS flow for support's merchant prefix `2814926`, the photographed full device terminal `2814926015`, and registers `003`–`006`. Pelecard must confirm the cloud request's terminal and register fields before live dispatch.

**Architecture:** Keep physical intents, credentials, workstation mapping, device transport, verification and Payper adapter independent of hosted checkout. A database reservation and register lock precede one provider dispatch. Verified provider evidence alone can atomically finalize a sale and document eligibility.

**Tech stack:** React POS, Supabase/Postgres, Vercel Node adapter, Vitest, Pelecard cloud API once supplied.

## Provider contract gate

- [ ] Obtain Pelecard's written cloud endpoint, authentication, register routing, callback/lookup/cancel and Payper transaction-ID contract described in `docs/pelecard/physical-cloud-terminal-investigation-2026-11-12.md`.
- [x] Record photo evidence for CT20 app `3.1.6`, full terminal `2814926015`, display register `4`, and require a separately configured ten-digit physical terminal value in the mocked workflow.
- [ ] Add contract tests from official examples and implement the physical transport, keeping its credentials separate. Automatically push the validated cart total to the assigned terminal, with no cashier amount entry on the device. Verify the provider's device acknowledgement and exact amount shown.
- [ ] Verify the customer can tap or insert a card on the device and that the POS request, result and storage contain no raw card details.

## Durable payment path

- [x] Add four fixed, disabled physical-device settings with admin-only label, enabled state and named cash register assignment; enforce one device per workstation. Rehearse the migration in disposable PostgreSQL.
- [ ] Bind each cashier browser/workstation to its named cash register in a server-verifiable way before enabling automatic device selection.
- [ ] Add an isolated migration for workstation mapping, immutable physical intents, unique request keys and one in-flight intent per register. No production migration without approval.
- [ ] In the server reservation, read catalog prices and validate discounts and total in agorot. Reject client amounts and register overrides.
- [ ] Claim dispatch atomically, persist the provider correlation before allowing any second action, and reconcile unknown outcomes with lookup only.
- [ ] Verify the final provider result through Pelecard's authoritative status API. Require matching merchant terminal, register, amount, intent reference, transaction ID and approved status before any sale.
- [ ] Add approval verification and an atomic one-sale finalizer with unique provider transaction identity and a unique sale-to-intent relationship. Repeated or concurrent verification must return the existing sale.

## Accounting and POS

- [ ] In the atomic sale finalizer, make only the verified physical payment eligible for the existing Payper pipeline. Add a physical Payper adapter with credentials and terminal scope confirmed by Pelecard. Use the existing one-shot ledger and document uniqueness constraints; do not change the continuous worker configuration.
- [ ] Issue the eligible physical payment as `invoice-receipt` automatically, set provider email delivery to the verified customer address, persist the document number and URL, and reconcile uncertain creation or delivery without blind reissuance.
- [ ] Add the flag-gated `תשלום במסופון פיזי` POS choice, workstation default and pending/recovery view. Keep hosted and manual external-credit actions intact.
- [ ] Mock concurrent starts, duplicate requests, provider timeout, offline device, cancellation race, browser recovery, mismatched approval, duplicate sale and duplicate document.
- [ ] Verify the hosted payment regression suite and full build. Seek explicit approval before any real charge, invoice, production migration or deployment.
