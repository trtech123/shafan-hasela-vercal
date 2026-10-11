# Customer billing and confirmation signature finalization

Released October 11, 2026. **Physical customer/billing/signature QA remains pending. Neither workflow is Production Verified yet.**

## Scope and behavior

- Existing reusable customers remain canonical. Billing identification belongs to the billed customer, not the signer. The customer editor, order form, confirmation preview and newly prepared PDF use explicit billing labels.
- Draft orders remain permitted. Confirmation preparation now requires an active linked customer and a matching immutable order customer snapshot: customer/billing name, nine-digit customer identification (Israeli checksum for a person; nonzero nine digits for an organization), explicit VAT, existing required phone/date/participant fields. Email/address were not made mandatory.
- Validation uses saved snapshot values, not silently updated customer-master values. Staff can edit/create/select a canonical customer and explicitly refresh the order snapshot from the confirmation panel. Existing payment-related snapshot locks remain unchanged.
- New public signing collects full name, normalized drawn strokes, and explicit acceptance only. No personal signer-ID input or billing-ID substitution. Optional validated IDs remain compatible with older clients and exact retries; historical IDs remain private and viewable by authorized staff.
- Legacy staff-entered signer inputs are hidden from the normal order form. Their columns and stored values remain untouched.
- New PDFs retain image-based signature ink, name, timestamp, acceptance and immutable revision association. Billing identification stays in the billing section. Safety/minor signature lines remain independent. Existing archives are never regenerated.

## Source and controlled release

- Authoritative predecessor: `dpl_52EaC8ywLTt2CcqQDeXS9peVSk5G`; all 198 source files verified against its retained artifact.
- Live candidate: `dpl_EMsgn1KYhNdpFPq3zLnUy56R4yHw`, promoted `2026-10-11T15:12:47.215Z`.
- Runtime candidate commit: `33042b8b5060f52afa87f9d41b396eb7df27d359`, isolated branch `feat/order-confirmation-signature`.
- Production artifact overlays nine reviewed application files on the actual predecessor, preserving 189 files exactly. All 198 uploaded candidate source hashes verified. Node runtime remains 24.x.
- Commits: `0719254` implementation; `42c155d` historical-ID migration fixture; `c2a5f2b` actual rendering-version compatibility and regression; `33042b8` failed-readiness-refresh recovery.
- Applied only `202610110003_order_confirmation_customer_readiness.sql`, SHA-256 `f81e0cecc6b41349add2a68e892c0318785cd024d5a532d8961ab97aa6f49197`. The live predecessor RPC body matched migration 002 exactly before replacement.
- Migration removes only the mandatory signer-ID constraint, preserves nullable ID validation, adds a private readiness helper, and narrowly updates signature preparation/history/acceptance. No historical row rewrite.
- No Edge Function, secret, Meta/WABA, financial/provider, club or attendance change. Deployment-level settings preserved. Vercel Git deployment sources remain blocked and unchanged. No push/merge to canonical main.

## Verification

- Final relevant Vitest run: **101 tests / 14 files passed**, 40.74 seconds under a 300-second deadline. Includes signature pad, contract/handler/page/history, actual PDF output, order preview, email/WhatsApp boundaries and existing utility-template behavior.
- Production build passed under a 180-second deadline.
- Disposable canonical migration rehearsal passed: signature, customer snapshots/HAKAFA vouchers, order delivery and delivery acceptance. Historical signed rows with and without ID, plus an existing pending request, remain byte-equivalent across migration 003. No-ID acceptance/replay of the pre-existing pending request passed.
- Synthetic mobile fixture passed under a 150-second deadline: isolated bundle/API and actual PDF annotation; no production configuration/provider access.
- Linux/serverless rehearsal: packaged Chromium under an isolated network namespace, 696 traced files / 72.44 MiB; actual current render version 2. 27 unsigned pages / 28 signed pages, 3,755 changed dark raster channels between different signatures, visible PNG ink, Hebrew/RTL, name/time, no ID in new acceptance section, optional historical-ID display, clickable links, exact embedded unsigned bytes, hash-mismatch rejection. All 80 activity markers present. Optional unused dependency tracing warnings unchanged.
- Independent spec and security/code reviews passed. Review caught a version-2/renderer-version-1 mismatch missed by old hardcoded fixtures; fixed before any release, with a regression using the actual exported version. Nested readiness-refresh failure now fails closed with Hebrew guidance.
- Accepted pre-existing baseline debt remains outside this scope: 17 failed assertions and one import-failing suite documented in the earlier pre-release report. The entire repository suite is not claimed green.
- Live non-sending checks: API method rejection 405, invalid link 404, unauthenticated staff request 401; signing page 200 with no-store/no-referrer; no service credential in client bundle; anonymous direct revision table/RPC denied. Authorized staff history succeeds, instructor history denied; private bucket/grants remain protected.
- Live UI: Orders and QA confirmation open, missing billing fields block preparation, canonical customer editor and selection accessible, explicit VAT and optional address retained, confusing legacy signer inputs absent. All opened forms cancelled without saving.
- Digests of all existing confirmation revisions and private artifact metadata unchanged. 35 business-table fingerprints and deployed Edge Functions unchanged. No customer/order/revision created or edited, and no email/WhatsApp sent.

## Final manual QA

ORD-1044 still has signed revision 1 and pending revision 2. Its linked customer is archived and its frozen billing identification is blank. Do not use either old signing link for final QA.

From Orders, find ORD-1044, open the customer confirmation and its billing-completion action. Create an active, clearly labeled QA customer or select an appropriate existing active QA customer. Supply that customer's billing identity, phone and explicit VAT; optional contact/email/address fields as applicable. Explicitly update the order snapshot and review the displayed details, then prepare a new revision (expected revision 3).

Copy its signing link without sending email/WhatsApp. Open privately on a physical phone; verify only full name, drawn signature and acceptance are required. Sign and submit. Refresh admin history and download the **signed PDF for the new revision**, not the current unsigned preview. In Windows Edge confirm visible drawn ink, signer name and timestamp; customer billing identification belongs in the billing section, no signer-ID field appears, and separate safety/minor signature lines are untouched. Revision 1 must remain available unchanged.

## Rollback and remaining gate

The predecessor deployment is retained for emergency application rollback. Preserve the additive schema, nullable historical identity, all revision rows and all private artifacts; never reintroduce a mandatory-ID constraint over newly accepted no-ID signatures. Prefer a scoped forward fix if needed. Previous UI may require signer ID again during an emergency rollback, so pause manual QA until the issue is resolved.

Stop before preparing another production revision. Await the user's physical-phone and Windows Edge result before declaring either target workflow Production Verified.
