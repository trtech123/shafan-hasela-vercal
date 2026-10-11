# Order confirmation signature candidate — release evidence

Follow-up: [pre-release validation](../../order-signature-prerelease-validation.md) records the successful isolated Linux package rehearsal, 92-test regression run, refreshed baseline classification and synthetic HTTPS mobile harness. Physical handset QA remains pending. The original evidence below is retained as a chronological record.

Implementation branch: `feat/order-confirmation-signature`, based on `ee8a44745484ff919a19ab00a5c8c183c83a2e6f`. This preserves the production-applied UUID migration. No production database, provider, Git remote, Meta or deployment settings were changed.

## Architecture

- Migration `202610110001_order_confirmation_signatures.sql` adds immutable revisions, private request identities, delivery attempts and short-lived hashed rate-limit buckets. It creates `order-signatures-private`; it does not widen the existing documents bucket policies or alter business records.
- `/api/order-confirmation` verifies staff sessions and uses service-only RPCs that independently enforce admin/operations/cashier roles. Public operations require a 256-bit random capability and cannot select arbitrary revisions. Only its SHA-256 hash is stored in the token column. Public callers have no direct table/RPC/storage grants.
- `/order-sign#<capability>` removes the fragment from visible browser history and keeps it in memory. Views do not consume signing authority. Name, normalized strokes and explicit acceptance are the only authoritative customer inputs. The server freezes document content and terms; internal notes are excluded.
- Public JSON returns only acceptance copy/version and limited revision metadata; it never returns raw legacy snapshots. Internal-note keys are removed recursively before freezing, including nested historical quotation items. Change comparisons use the same sanitized data.
- A two-minute recoverable signing claim preserves server acceptance time and the exact payload. An append-only registry prevents a retired request ID from reclaiming an old artifact key. Finalization binds the privately stored signed artifact hash atomically to the revision evidence. Orphan artifacts from interrupted requests remain inaccessible and are not treated as signed evidence.
- Server Chromium renders the frozen unsigned artifact, including an actual HTTPS link annotation. The signed artifact appends visible acceptance evidence to the original pages and embeds the exact unsigned PDF bytes. Separate safety/minor signature lines remain blank.
- New `send-order-signature` reuses the existing SMTP and WhatsApp provider implementations. It downloads the private authoritative PDF and verifies its hash. Email adds a prominent signing link; WhatsApp retains the exact existing `order_confirmation_pdf` template and its three body parameters. No new WhatsApp template, subscription or routing configuration is needed.
- Staff revision history preserves old signed downloads and earlier delivery history. Changed current orders are labelled; a changed order cannot accept an outstanding stale invitation. Manual resend is explicit and linked to the previous attempt, with the existing two-minute in-flight guard.
- The neutral signature pad retains HAKAFA drawing mechanics and separate voucher wording. No voucher authorization, registers or business rules are imported into order signing.

## Verification evidence

- Final focused feature/provider/pointer/public-page/admin-history/PDF/order-confirmation integration tests: **49 passed** across ten files, including the public snapshot privacy regression.
- Full suite before refreshing the obsolete order-confirmation tests: **666 passed, 28 failed**, plus one import-failing suite; 65 passing / 8 failing files. All 28 failure names and the import error were reproduced on clean `ee8a447`. No unrelated production code was changed to address this baseline debt. The eleven obsolete order-confirmation tests were replaced by four tests of the actual authoritative document/revision-management integration.
- Remaining baseline suites: AccountingOperations (7 failures), QuoteFormDialog (5), cashRegisterPelecard (2), ClubAttendance (1), PaymentScreen (1), Quotes.productConversion (1), and QuotePDFDocument.product (import failure). These are not green release evidence.
- A final full-suite repeat stalled after the same PaymentScreen and ClubAttendance failures and was interrupted; it is not counted as a passing run. Focused feature checks are run independently.
- `node scripts/signatures/rehearse.mjs`: all canonical migrations followed by signature, customer/HAKAFA voucher, order delivery, and delivery acceptance SQL suites passed in disposable PGlite. Tests exercise anon/authenticated denial, instructor denial, private storage RLS, expiry/revoke/supersede/stale order, unchanged signed evidence, duplicate/replay/lease recovery, retired IDs, rate limiting and delivery claims/manual resend.
- `deno check supabase/functions/send-order-signature/index.ts`: passed. `npm run build`: passed; existing Browserslist age warning only. Frontend output scan found no server-service configuration identifiers.
- Real local Chromium PDF tests check multi-page Hebrew content, link annotations, exact embedded unsigned bytes, original first-page pixel equality and evidence hashes. Synthetic PDF pages were visually inspected for Hebrew text, layout and visible signature evidence.
- Local desktop browser smoke test used only a synthetic local API: archived PDF visible, full name input, mouse drawing, clear/re-draw, explicit acceptance, empty-signature rejection and success state passed. This is not evidence of production delivery or a physical handset test.
- Independent specification and security reviews passed after fixing retired-request artifact reuse and interrupted-signing/re-send UI recovery.

## Remaining release gates

1. **Real mobile PDF viewer:** open the unsigned PDF on an actual target handset and verify that its link annotation opens the correct signing page with its fragment intact. Automated annotation checks and desktop Chrome cannot substitute for this requirement. Also perform a physical finger-signing acceptance check.
2. **Deployment-runtime rehearsal:** validate packaged Linux Chromium, fonts/logo inclusion, function size/memory and cold-start timing in an isolated nonproduction environment. Local Windows Chromium rendering and Vite build do not prove the target Vercel runtime. Docker is unavailable on the local machine.
3. **Baseline suite debt:** resolve or explicitly disposition the reproduced unrelated failing suites before declaring the entire project test suite green. Do not change unrelated systems as part of this feature.
4. **Authorized release smoke:** private bucket access, staff roles, link expiry/revocation, signed old revision after an order edit, admin download and approved single-recipient email/WhatsApp delivery. No such production test has been performed.

## Runtime configuration (names only)

Vercel server: `SUPABASE_URL` (or existing `VITE_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`, explicit HTTPS `ORDER_SIGNATURE_PUBLIC_ORIGIN`; optional `ORDER_SIGNATURE_TOKEN_DAYS` (1–30, default 7). The service credential must never have a `VITE_` prefix. Supabase Edge: explicit matching `ORDER_SIGNATURE_PUBLIC_ORIGIN` plus the existing SMTP/Meta configuration. Do not rotate existing credentials. No values were read or changed for this implementation.

Puppeteer is pinned to 25.11.0 alongside Chromium 153.0.0 according to the [official supported-browser mapping](https://pptr.dev/supported-browsers). PDF font data is bundled under its OFL license; rendering blocks network resources. Packaging and response-header additions in `app/vercel.json` affect only the new feature and do not change deployment-source policy. [Vercel configuration reference](https://vercel.com/docs/project-configuration/vercel-json).

## Controlled release plan — not executed

1. Complete the nonproduction runtime and physical device gates, review this exact commit and reconcile its base against authoritative current production. Keep the UUID fix in history. Do not deploy an unrelated dirty checkout or merge/push automatically.
2. After separate release authorization, configure the required server-only settings securely, apply only the additive signature migration, and verify service-only RPC/table/private-bucket authorization.
3. Deploy only the new `send-order-signature` function with its referenced existing provider modules. The current email, quotation, WhatsApp bot and template paths remain unchanged.
4. Release the reviewed frontend/Node API candidate through the established production-preserving process. Git auto deployment stays blocked.
5. Run approved minimal smoke tests and confirm that a real customer signs exactly the PDF revision delivered. No financial operations or arbitrary-customer messages.
6. Rollback: revert the application/Edge release or disable the new route while retaining all revision/evidence/claims/storage data. Never drop the new tables/bucket or overwrite signed evidence. Failed private staging artifacts require a separately reviewed retention policy; no cleanup is included here.

## Reproducing local checks

From `app`: `npm ci`, then `npm test -- --pool=threads --maxWorkers=2 orderSignature SignaturePad.test OrderSignature.test OrderSignaturePanel.test send-order-signature orderConfirmationResendBoundary OrderConfirmationPDF.test` and `npm run build`.

PDF tests require Chromium (Windows Chrome/Edge auto-detected, or `CONFIRMATION_CHROMIUM_PATH`) and Poppler (`pdftotext`, `pdftoppm`). The disposable rehearsal uses the existing local PGlite dependency installation under `.tmp/payment-db/node_modules/@electric-sql/pglite` and never connects to Supabase. Synthetic artifacts and raw test logs stay in ignored `.tmp/signature-qa` directories.
