# Physical Cloud Terminal Implementation Plan

**Goal:** Add a separately gated card-present POS flow for merchant terminal `2814926` and registers `003`–`006`.

**Architecture:** Keep physical intents, credentials, workstation mapping, device transport, verification and Payper adapter independent of hosted checkout. A database reservation and register lock precede one provider dispatch. Verified provider evidence alone can atomically finalize a sale and document eligibility.

**Tech stack:** React POS, Supabase/Postgres, Vercel Node adapter, Vitest, Pelecard cloud API once supplied.

## Provider contract gate

- [ ] Obtain Pelecard's written cloud endpoint, authentication, register routing, callback/lookup/cancel and Payper transaction-ID contract described in `docs/pelecard/physical-cloud-terminal-investigation-2026-11-12.md`.
- [ ] Add contract tests from official examples and implement the physical transport, keeping its credentials separate. Verify the provider's device acknowledgement and exact amount shown on the assigned terminal.
- [ ] Verify the customer can tap or insert a card on the device and that the POS request, result and storage contain no raw card details.

## Durable payment path

- [ ] Add an isolated migration for workstation mapping, immutable physical intents, unique request keys and one in-flight intent per register. No production migration without approval.
- [ ] In the server reservation, read catalog prices and validate discounts and total in agorot. Reject client amounts and register overrides.
- [ ] Claim dispatch atomically, persist the provider correlation before allowing any second action, and reconcile unknown outcomes with lookup only.
- [ ] Verify the final provider result through Pelecard's authoritative status API. Require matching merchant terminal, register, amount, intent reference, transaction ID and approved status before any sale.
- [ ] Add approval verification and an atomic one-sale finalizer with unique provider transaction identity and a unique sale-to-intent relationship. Repeated or concurrent verification must return the existing sale.

## Accounting and POS

- [ ] Add a physical Payper adapter with credentials and terminal scope confirmed by Pelecard. Use the existing one-shot ledger and document uniqueness constraints; do not change the continuous worker configuration.
- [ ] Add the flag-gated `תשלום במסופון פיזי` POS choice, workstation default and pending/recovery view. Keep hosted and manual external-credit actions intact.
- [ ] Mock concurrent starts, duplicate requests, provider timeout, offline device, cancellation race, browser recovery, mismatched approval, duplicate sale and duplicate document.
- [ ] Verify the hosted payment regression suite and full build. Seek explicit approval before any real charge, invoice, production migration or deployment.
