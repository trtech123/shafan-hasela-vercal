# Order confirmation signature pre-release validation — 2026-10-11

Application candidate: `51404cf61b6535613808f20be1b286b0e8a42eeb`, branch `feat/order-confirmation-signature`. This follow-up adds only rehearsal scripts and QA documentation. No application regression requiring a fix was identified. No production access, provider send, deployment, migration, push, merge, Meta change or deployment-policy change was performed.

## Linux/serverless rehearsal: PASS, within the stated boundary

- Ubuntu 22.04 x86_64 under existing WSL; Node 22.20.0 downloaded from nodejs.org and checked against its published SHA-256 list. Production dependencies installed from the candidate's lockfile with `npm ci --omit=dev --ignore-scripts` in `/var/tmp/shafan-signature-preflight/candidate/app`, with a 300-second deadline.
- Actual `@sparticuz/chromium` 153.0.0 and Puppeteer 25.11.0, no local desktop browser override. `VERCEL=1` activates the package's bundled AL2023 libraries. No production configuration or credentials loaded.
- Render execution ran inside `unshare -mn`, with an isolated fresh tmpfs at `/tmp`, only loopback enabled, and a 120-second process deadline. External provider access was impossible from this network namespace.
- `@vercel/nft` 0.30.4 traced the actual Node API entrypoint; configured font/logo/Chromium include-files were copied into a separate package. **695 files, 75,960,233 bytes / 72.44 MiB.** The packaged API imported and returned the expected sanitized missing-configuration response.
- The trace reported optional telemetry (`@opentelemetry/api`), browser-download/proxy (`yauzl`, `proxy-agent`), and optional WebSocket accelerators (`bufferutil`, `utf-8-validate`) as unresolved. Packaged API import and the actual installed-browser rendering path passed without them. No dependency was added to application manifests.
- Packaged cold unsigned render: **16.791 seconds**; signed appendix: **3.521 seconds**; whole rehearsal **26.73 seconds**. `/usr/bin/time` maximum resident set statistic: **189,992 KiB** (not an aggregate production concurrency memory guarantee).
- Synthetic 80-activity confirmation: **27 unsigned pages / 28 signed pages**, 332,799 / 466,321 bytes. Hebrew/RTL and signature were visually inspected. Poppler found `QA_ITEM_80` and the expected unsigned hash. Original first-page pixels matched exactly after signing.
- SHA-256, exact embedded unsigned bytes, rejection of a wrong unsigned hash, and clickable HTTPS fragment annotations in both PDFs passed. No expectation that independently rerendered PDFs have identical bytes: the archived artifact is authoritative.

Two initial fixture failures were diagnosed without modifying the renderer: plain Ubuntu lacked the serverless libraries until `VERCEL=1`; a custom `TMPDIR` conflicted with the package's fontconfig paths under `/tmp/fonts` and produced blank text. Using the standard isolated `/tmp` fixed the latter. The rehearsal now rejects PDFs with no embedded text fonts. Do not configure a custom production `TMPDIR` for this package without a separate validation.

This is a traced Linux package rehearsal, not a Vercel deployment or proof of exact hosted cold-start/concurrency limits. At release, verify Node runtime compatibility, bundled assets, memory and the configured 60-second function duration. The observed PDFs are also below Vercel's response payload limit. References: [Chromium package](https://github.com/Sparticuz/chromium), [Vercel payload limit](https://vercel.com/docs/errors/function_response_payload_too_large).

Reproduction entrypoint: `scripts/signatures/rehearse-linux.mjs <artifact-directory>` from a Linux copy of the candidate, using its installed application dependencies. Set `VERCEL=1`, retain standard `/tmp`, unset production configuration, and disable external networking. The local ignored `.tmp/signature-qa/linux-setup.sh`, `linux-package-run.sh`, and `trace-package.mjs` record this machine's exact setup and package-copy procedure. Generated PDFs/logs are synthetic and remain ignored under `.tmp/signature-qa/linux-package`.

## Regression evidence

- Relevant regression command: `vitest run --pool=threads --maxWorkers=2 --testTimeout=30000 --hookTimeout=30000 orderSignature SignaturePad.test OrderSignature.test OrderSignaturePanel.test send-order-signature orderConfirmationResendBoundary OrderConfirmationPDF.test whatsappDocumentProviders sendWhatsappPayload orderPolicy`.
- **92 tests / 13 files PASS**, 139.65 seconds, under a 300-second external deadline that kills only the spawned process tree.
- Disposable canonical migration rehearsal: signature, HAKAFA/customer vouchers, order delivery and delivery acceptance SQL suites all **PASS**, under a 90-second deadline.
- Mobile fixture test: **PASS**, actual renderer PDF/link plus isolated bundle and synthetic request boundary checks, under a 120-second deadline. No LAN listener or trust configuration was created by the tests.
- Fresh Vite production build: **PASS**, under a 180-second deadline; only the existing Browserslist age warning.

## Existing unrelated failures

The prior completed candidate run reported 666 passed / 28 failed assertions, plus an import-failing suite. Matching runs on unchanged `ee8a447` reproduced all failures. Eleven obsolete OrderConfirmationPDF tests were subsequently replaced by four tests of the current integration, now passing. Remaining failures:

| Suite | Classification | Evidence/cause |
| --- | --- | --- |
| AccountingOperations (7) | Pre-existing confirmed baseline | Missing AuthProvider in test fixture |
| QuoteFormDialog (5) | Pre-existing confirmed baseline | Missing AuthProvider in test fixture |
| Quotes.productConversion (1) | Pre-existing confirmed baseline | Missing AuthProvider in test fixture |
| cashRegisterPelecard.contract (2) | Pre-existing confirmed baseline | Stale implementation/route expectations |
| PaymentScreen.pelecard (1) | Pre-existing confirmed baseline | Test omits `pelecardEnabled`, default false |
| ClubAttendance (1) | Pre-existing confirmed baseline | Same empty session fixture failure; deeper fixture/race cause inconclusive |
| QuotePDFDocument.product (suite import) | Pre-existing confirmed baseline | Missing Supabase environment/mock |

These seven test files and their components are unchanged between the base and candidate. **17 failed assertions plus one import-failed suite remain baseline debt; no feature-caused failure identified.** A fresh grouped comparison reached its 90-second hard deadline before emitting results, so that rerun is **inconclusive**, not a pass. Do not call the entire project suite green. No unrelated test or business implementation was changed.

## Physical mobile gate

Harness and exact device instructions: [Mobile QA](order-signature-mobile-qa.md). The actual signing UI and actual-renderer PDF run against an in-memory synthetic API, with Supabase replaced by a rejecting stub. HTTPS and an explicitly chosen private interface are required; no production data or service credentials are involved.

**Ready to perform; not yet physically executed.** A device owner must verify PDF viewer link opening, finger drawing, clear/redraw, explicit acceptance and success in a secure context. Production release stays blocked until this evidence is recorded or the user explicitly changes that gate.

## Controlled release procedure — prepared, NOT executed

1. Complete the physical handset checklist and record device/browser/PDF viewer results. Disposition the confirmed baseline failures explicitly; do not hide them as passing tests.
2. Reconfirm the current authoritative production source/deployed functions and schema. Reconcile only this feature and the already-applied UUID migration; do not wholesale deploy or merge canonical main. Keep Vercel Git auto-deployment blocked.
3. Review the exact additive migration `202610110001_order_confirmation_signatures.sql`, private bucket, grants and service RPCs. Apply **only this migration** through the approved migration tool, recording it in the production migration ledger. Do not run a blanket push of pending migrations. Preserve all existing records.
4. Securely configure the Node API with existing server-only Supabase credentials and explicit HTTPS `ORDER_SIGNATURE_PUBLIC_ORIGIN`; optional `ORDER_SIGNATURE_TOKEN_DAYS=7`. Configure the same origin on the new Edge Function. Never use a `VITE_` prefix for service credentials; do not rotate credentials or modify provider configuration.
5. Deploy only `send-order-signature` with its referenced existing shared provider modules. Keep `order_confirmation_pdf` and all Meta/WABA routing unchanged.
6. Release the reviewed frontend and Node API package through the existing production-preserving manual release process. Verify compatible Node runtime, packaged Chromium/font/logo assets, standard `/tmp`, memory and 60-second duration. No automatic Git deployment or incidental unrelated changes.
7. Read-only checks first: unauthenticated direct DB/storage denied, instructor denial, allowed staff history/read, missing/expired/revoked token handling, and private artifact paths inaccessible. Then use a separately authorized, minimal designated QA confirmation/recipient for real signing and email/WhatsApp smoke; no financial records or arbitrary customer sends.
8. Verify exact revision/hash association, signed download, original evidence retained after an order change, and existing delivery history. Stop on any unexpected behavior before wider rollout.
9. Rollback application/Edge release or disable new entrypoints if needed. **Retain** new tables, private artifacts and signed evidence; do not drop, overwrite or delete records. Review any orphan-artifact cleanup separately.
