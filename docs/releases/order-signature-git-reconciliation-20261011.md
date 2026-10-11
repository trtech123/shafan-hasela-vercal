# Order Confirmation signature Git reconciliation — 2026-10-11

**ORDER CONFIRMATION SIGNATURE: PRODUCTION VERIFIED**, based on the user's
completed physical-phone QA: signing, acceptance, inline handwritten signature,
signer name/timestamp and final UX all passed. Earlier pending-QA release notes
remain historical records; this record supersedes their pending status.

## Source and scope

Canonical main initially pointed to `322c8f8439af976eb75de30843a84fc6633c79f0`
and lacked all signature changes. Production remains
`dpl_6pzSe9vsoSAFH6GKoeUnQK1XFamg`, runtime source
`514735bf85c47d7302698077e4d28208cda16863`.

Reconciliation cherry-picks the 16 signature-only commits following `ee8a447`
through `1ed29a1`, preserving their order and the complete migration history.
All 198 deployed application source files match the candidate after line-ending
normalization. The downloaded deployed signature Edge Function and its shared
dependencies match all seven source files. All seven final signature SQL function
bodies match production. No application behavior changes were introduced here.

Final behavior includes billing-independent preparation, no required signer ID,
native accessible acceptance checkbox, embedded raster ink inside the existing
confirmation signature area, protected signed-artifact preview/download and
unchanged immutable historical evidence. Customer billing remains independent.

## Commit provenance

| Original signature commit | Reconciled commit |
|---|---|
| 51404cf | ab53faf |
| 37d2f52 | 68b900d |
| 7b4571d | e4de27e |
| 5d22c2f | 1d10f7b |
| d642a08 | 4110199 |
| 0719254 | 7ad6fc7 |
| 42c155d | 24cdd41 |
| c2a5f2b | b1034a9 |
| 33042b8 | 0b5f398 |
| 4379f1f | 3113019 |
| 09f28b0 | 3f4f140 |
| d366fc7 | 718304f |
| 4c092ad | 1028dc7 |
| 986e998 | 55a694a |
| 514735b | c18811d |
| 1ed29a1 | e039413 |

## Validation and synchronization safety

- Production build passed against the isolated reconciliation candidate.
- Disposable migration rehearsal passed, including signature authorization,
  immutable historical evidence/IDs, preparation without billing, customer
  snapshots, HAKAFA and delivery regression suites.
- Fresh isolated Linux packaged-Chromium rehearsal passed with networking
  disabled: 27-page unsigned/signed documents, inline signature on page 25,
  2,099 ink channels, blank-image negative control rejected, signed CTA absent,
  clickable unsigned link and exact original unsigned attachment retained.
- The initial two-worker Vitest run passed 99 tests but could not start one
  worker. The bounded single-worker rerun passed all 113 tests in 13 files
  in 52.67 seconds. The separate UUID-fix provider-test file is not included.
- Previously accepted unrelated baseline failures are not fixed or represented
  as passing by this reconciliation.
- Vercel's effective `deploymentPolicy.deploymentSources` permits CLI/API/hook/
  integration/v0 sources and excludes Git. Recheck immediately before pushing;
  do not change the policy. Compare deployment list, live alias, function
  versions, database function/revision/artifact fingerprints after pushing.
- No production deployment, migration, signature revision, message, secret or
  provider configuration change is part of this task.

## Separate outstanding WhatsApp reconciliation

`ee8a44745484ff919a19ab00a5c8c183c83a2e6f` remains on
`fix/whatsapp-bot-uuid`. Its production-applied
`202610090001_chatbot_uuid_resolution.sql` and two supporting test/rehearsal
files are deliberately excluded. Reconcile that fix separately; do not apply its
migration again merely because canonical Git previously lacked the file.

The original workspace contains pre-existing unrelated uncommitted changes.
They are not incorporated, discarded or cleaned by this reconciliation.
