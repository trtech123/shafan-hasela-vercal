# Visible signed confirmation — controlled correction

## Diagnosis (2026-10-11)

Read-only inspection of ORD-1044 revision 3 found two valid normalized strokes
(119 points). Its four-page unsigned and five-page signed archives match their
recorded SHA-256 hashes. The actual local admin download is byte-for-byte the
signed archive. Independent PDF rasterization visibly shows the drawn ink on
page five. The user confirmed they had viewed the admin preview/earlier pages.
No evidence or renderer loss was reproduced; the presentation was confusing.

The admin preview displayed the mutable unsigned order. The signed document
preserved the original invitation to sign in its original pages, followed by a
separate acceptance page. Historical archives must not be rewritten.

## Narrow correction

- Provide an authenticated preview of the actual archived signed PDF, opening
  at its acceptance destination (last page for older archives).
- Download the identical authenticated Blob used by that preview.
- Collapse the clearly labeled mutable unsigned preview and its download.
- New signed PDFs use the requested digital-acceptance heading and a standard
  internal PDF opening destination at the signature appendix. No PDF script.
- Keep embedded raster ink, original pages and exact attached unsigned bytes.

No migrations, token changes, billing requirements, public signing fields,
historical evidence rewrites, provider sends, or storage-policy changes.

## Verification gates

Actual PDF regression checks rendered ink in the expected signature area,
removes embedded image pixels as a negative control, rejects missing strokes,
and exercises the real signed-artifact HTTP selector with signed/unsigned PDFs.
UI tests verify protected artifact selection, identical preview/download bytes,
failure without unsigned fallback, and URL cleanup. Existing signing, pointer,
delivery and snapshot regressions remain required. Linux rehearsal uses packaged
Chromium with networking disabled, checks RTL, long pagination, ink area,
blank-image rejection, exact original attachment, hashes and clickable links.

## Release and rollback

Reconcile against authoritative production dpl_9xwuUyapjT1TohjxegLrE6f8sqPe.
Copy its retained, hash-verified source and overlay only reviewed runtime files.
Stage without moving the public alias; verify source hashes and protected API.
Preserve deployment-level environment values and the blocked Git-source policy.
Recheck business/evidence/storage/function fingerprints before promotion.
Rollback is promotion of that prior deployment; no database rollback applies.

After promotion, inspect the existing revision 3 preview read-only and confirm
all historical data/artifact fingerprints remain unchanged. Do not create or
sign a new revision automatically. Physical-phone/Windows Edge retest remains
the user's final acceptance gate; do not mark Production Verified.

## Release receipt

- Runtime commit: `4c092ad202159f0adc89d8f6d533521442c1f2f7` (local branch only).
- Live deployment: `dpl_7Gy3Rt6SgZ4xLs1n9mTiUGwBwJ6x`.
- Promoted: 2026-10-11 16:38:25 UTC. All 198 staged source hashes verified;
  three runtime files changed and 195 preserved exactly.
- Relevant suite: 108 tests passed. Final UI refinement: 18 tests passed.
  Build passed; disposable signature/HAKAFA/customer/delivery suites passed.
- Network-isolated Linux rehearsal: 27 unsigned / 28 signed pages, 1,988
  signature-area ink color channels; blank-image negative control rejected.
- Production authorization: invalid token 404; unauthenticated staff 401;
  anonymous direct table/RPC 401; instructor denied; authorized history passed.
- Production UI opened existing revision 3 at page 5 and visibly displayed its
  original ink. Download from that preview exactly matched archived bytes.
- All three revision rows and stored artifacts retained identical fingerprints;
  35 business tables, Edge Functions and Git deployment policy unchanged.
- No migration, provider sends, new QA revisions or production business writes.
  Technical rate-limit counters may advance during non-sending API checks.
- Physical new-revision/Windows Edge acceptance remains **PENDING**.
