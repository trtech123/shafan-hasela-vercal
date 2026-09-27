# Controlled Pelecard TEST activation

**Goal:** Prepare an isolated hosted-payment TEST path in the existing Supabase project. Stop before initialization or any card transaction. LIVE execution remains disabled.

**Architecture:** Explicit server-only `PELECARD_MODE=test`, three TEST-only credentials with no fallback, per-operation endpoints (gateway20 initialization; gateway21 REST retrieval/validation), and an additional `PELECARD_TEST_TRANSACTION_ENABLED=true` gate for session creation. Dedicated admin-only TEST operations and feedback functions write only to `pelecard_test_payments`, never commercial payments/orders/sales or accounting. Existing commercial execution functions reject all operations during this activation; normal Rivhit implementation is untouched.

**Provider evidence:** Supplied January 2025 Services REST manual, local `docs/pelecard/Pelecard_Services_REST_API_Programmer_Manual_2025-01.pdf.pdf`, pages 4, 17–19. It documents gateway21 Services developer tooling and gateway21 PaymentGW verification, with transaction fields inside ResultData. The user explicitly designated it as the REST contract authority. Independently, current official gateway20 IFrame Chart documents gateway20 initialization; its developer tool also exposes gateway20 retrieval with a flat response example. Do not use that flat response shape for the manual's gateway21 contract, infer host interchangeability, or switch hosts on failure. API StatusCode=000 means operation success; transaction ShvaResult=000 and payment action/evidence must be checked separately. The supplied main error-code document defines 000 as a valid transaction; the Hebrew 08/2024 manual distinguishes action StatusCode from ShvaResult. The reported verbal 00 has no documented field mapping and is not accepted or normalized. Cross-host session retrieval remains an E2E proof item, not a claim established by credential preflight.

- [ ] Inspect deployed function metadata/source before any production mutation. Initial CLI attempt returned 401; deployment stays blocked until access is restored.
- [ ] Write and run failing credential-selection, fixed endpoint, strict status, secret-safe failure and commercial-blocking tests.
- [ ] Implement a narrowly scoped server-only provider transport. No raw provider responses, credentials, card data or terminal values are returned/logged/stored. HTTP redirects are rejected.
- [ ] Add TEST-only ledger with service-role write access, no commercial links, immutable identity and concurrency-safe initiation/verification.
- [ ] Add admin-only test preflight/initiate/verify/status and public feedback/return handling. Return and feedback only trigger authoritative retrieval, never trust supplied status. The browser return itself makes no state change.
- [ ] Prove no TEST path calls commercial finalization or Rivhit. Test duplicate requests, replay, mismatch, unknown statuses, malicious payloads, and disabled modes.
- [ ] Run payment and full regression suites, Deno checks, disposable PostgreSQL SQL workflow tests, production build, and exposure checks.
- [ ] Compare remote sources before deploying only changed functions/migration; leave initialization disabled. Never deploy if state cannot be verified.
- [ ] If access permits, run server-side GetTerminalName preflight using only TEST credentials and return a boolean result; no transaction or customer data is requested.
- [ ] Produce A–L checkpoint with actual evidence and remaining blockers. No initialization, charge, real card, refund, void, or other monetary operation before explicit approval.
