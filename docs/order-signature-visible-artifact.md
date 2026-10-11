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
