# Physical Cloud Terminal Implementation Plan

**Goal:** Add a separately gated card-present POS flow for support's merchant prefix `2814926`, the photographed full device terminal `2814926015`, and registers `003`–`006`. Pelecard must confirm the cloud request's terminal and register fields before live dispatch.

**Architecture:** Keep physical intents, credentials, workstation mapping, device transport, verification and Payper adapter independent of hosted checkout. A database reservation and register lock precede one provider dispatch. Verified provider evidence alone can atomically finalize a sale and document eligibility.

**Tech stack:** React POS, Supabase/Postgres, Vercel Node adapter, Vitest, Pelecard cloud API once supplied.

## Provider contract gate

- [ ] Obtain Pelecard's card-present J4 sample request/response, empty-card device-read semantics, maximum response time, authentication activation, final-state lookup shape and Payper transaction-ID contract described in `docs/pelecard/physical-cloud-terminal-investigation-2026-11-12.md`. Support confirmed the J4 method, full terminal and `shopNumber` routing, but the official builder requires card fields.
- [x] Record photo evidence for CT20 app `3.1.6`, full terminal `2814926015`, display register `4`, and require a separately configured ten-digit physical terminal value in the mocked workflow.
- [x] Add read-only `CheckGoodParamXEMV` and `GetTransDetailsEMV` transports with physical credentials, fixed URLs, response projection and mocked tests. Financial `DebitRegularType` dispatch stays blocked until Pelecard supplies its card-present form without raw card input.
- [ ] Verify the customer can tap or insert a card on the device and that the POS request, result and storage contain no raw card details.

## Durable payment path

- [x] Add four fixed, disabled physical-device settings with admin-only label, enabled state and named cash register assignment; enforce one device per workstation. Rehearse the migration in disposable PostgreSQL.
- [ ] Bind each cashier browser/workstation to its named cash register in a server-verifiable way before enabling automatic device selection.
- [x] Add an isolated migration for physical intents, unique request keys and one in-flight intent per register. No production migration without approval.
- [x] Add server catalog repricing and admin discount validation in agorot. Reject client amounts and register overrides; the reservation RPC also checks snapshot arithmetic.
- [x] Claim dispatch atomically and never permit a second claim after an uncertain outcome. The checkout request ends after reservation; a separate worker will dispatch when the provider contract is confirmed.
- [ ] Verify the final provider result through Pelecard's authoritative status API. Require matching merchant terminal, register, amount, intent reference, transaction ID and approved status before any sale.
- [x] Add a correlated approval observation RPC and atomic one-sale finalizer with unique provider transaction identity and sale-to-intent relationship. Disposable PostgreSQL tests prove repeated finalization returns the same sale. Provider response mapping remains unconfirmed, so live verification is closed.

## Accounting and POS

- [ ] In the atomic sale finalizer, make only the verified physical payment eligible for the existing Payper pipeline. Add a physical Payper adapter with credentials and terminal scope confirmed by Pelecard. Use the existing one-shot ledger and document uniqueness constraints; do not change the continuous worker configuration.
- [ ] Issue the eligible physical payment as `invoice-receipt` automatically, set provider email delivery to the verified customer address, persist the document number and URL, and reconcile uncertain creation or delivery without blind reissuance.
- [ ] Add the flag-gated `תשלום במסופון פיזי` POS choice, workstation default and pending/recovery view. Keep hosted and manual external-credit actions intact.
- [ ] Mock concurrent starts, duplicate requests, provider timeout, offline device, cancellation race, browser recovery, mismatched approval, duplicate sale and duplicate document.
- [ ] Verify the hosted payment regression suite and full build. Seek explicit approval before any real charge, invoice, production migration or deployment.
