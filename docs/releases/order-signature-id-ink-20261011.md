# Signature identity and PDF compatibility correction — 2026-10-11

Production status: NOT VERIFIED; physical retest is required. User reported successful phone capture/submission and persisted signer/time, but no visible ink in the downloaded five-page signed PDF in Windows Microsoft Edge.

## Evidence and diagnosis

Read-only ORD-1044 revision 1 inspection confirmed four strokes / 39 points, finite coordinates within [0,1], nonzero drawing extents, correct revision/request artifact path, and matching unsigned/signed SHA256 hashes. The signed archive has five pages; its last page visibly renders the drawing in Poppler and the available Chromium PDF viewer. Name and revision hash are present. This does not reproduce or explain the user's Windows Edge blank result. No evidence was lost in storage; the exact viewer-specific cause remains unresolved. Do not claim a confirmed vector-renderer defect or that the user downloaded the wrong file.

Compatibility safeguard for new signed artifacts: rasterize only the bounded signature SVG into a high-resolution PNG before PDF generation. Names, ID, timestamps and other text remain searchable. Original confirmation pages and exact embedded unsigned bytes remain preserved. Historical signed PDF bytes and signature evidence are never regenerated or rewritten.

## New identity requirement

Signer ID is a required nine-digit string with leading zeroes preserved. Spaces/hyphens normalize away; checksum, length, nonnumeric and empty values are validated in client, server and database. It is evidence, not identity authentication or signing authorization. The high-entropy token remains the authorization mechanism.

Additive `202610110002_order_confirmation_signer_id.sql` adds nullable `signer_id`, checksum constraint, a NOT VALID constraint requiring ID on future signed writes, and narrowly replaces the service-only action RPC for claim/replay/history. The existing immutability trigger also protects the new column. Existing signed rows remain unchanged with null ID, labelled historical/pre-ID in staff history. No ID backfill. New revision creation remains available without editing the order.

IDs appear only in private evidence, signed PDFs and authenticated staff history. Public token-resolution/sign responses, token URLs, filenames and delivery payloads do not include them. No ID logging or analytics added. HAKAFA and separate safety/minor signatures remain independent.

## Verification

- Tests first: missing ID/normalization, explicit download labels and portable PDF image assertions failed before implementation.
- Actual raster regression compares dark ink in two PDFs with identical text and different strokes. Deliberately blanking SVG ink causes this test to fail even though signature input and a PNG image remain present; renderer restored after the mutation check.
- Focused regression: 98 tests across 13 files passed before the final exact-label adjustment; final rerun recorded in release receipt.
- Disposable migration rehearsal: legacy evidence unchanged; new same-order revision; ID/checksum/normalization/replay/immutability; all signature, HAKAFA/customer voucher and delivery SQL suites passed.
- Linux/serverless packaged Chromium rehearsal: 696 traced files, 72.44 MiB; isolated network/mount namespace; 27 unsigned / 28 signed pages; real image ink difference 3755 channels; ID/name/timestamp present; original embedded bytes, hash mismatch rejection and clickable links passed. Synthetic acceptance page visually checked for Hebrew/RTL and ink.
- Independent spec/security and code-quality reviews passed. No unrelated baseline failures changed. No real provider sends.

## Controlled release and retest

Reconcile against current `dpl_AZDsa7wHok7P5ttYhWA5R3d17cHZ` and its exact 197-file artifact, overlay only this signature delta. Confirm no in-flight requests before the additive migration. Stage and verify the application, apply only the new migration, promote with Git deployment policy unchanged. No Edge Function or secret change is required. Compare all previous evidence hashes, artifacts, business tables and existing functions before/after.

Never roll back by deleting evidence or dropping the new column. Earlier frontend clients cannot submit without ID after the migration; refresh them. Preserve the previous deployment for application rollback, but retain required-ID enforcement; old application signing would fail safely until the compatible app is restored.

After read-only smoke checks, stop before creating revision 2. User prepares a NEW revision of ORD-1044, checks invalid/valid ID, finger capture/clear/redraw/acceptance, signed admin identity, and signed PDF ink/name/ID/time in both the phone viewer and Windows Edge. Separate safety/minor lines must remain blank. Final production verification is pending that retest.
