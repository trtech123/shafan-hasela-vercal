# Inline confirmation signature and consent correction

## Approved scope

Newly completed signatures replace the existing confirmation signing CTA with
the signer's name, visible embedded PNG ink and signing time inside that same
acceptance section. Normal pagination is allowed; a separate evidence appendix
is not. Safety/minor signature blanks remain separate. Existing archives are
never rewritten. No billing or provider workflow changes.

## Implementation

The signing handler supplies the server-claimed frozen snapshot to the PDF
renderer. It verifies the original PDF hash, canonical snapshot hash, revision
ID, acceptance wording and acceptance version. It renders the frozen document
with the completed acceptance section and privately embeds the exact original
unsigned PDF. New revisions use render version 3; pending versions 1 and 2 are
supported. Existing signed replay/download returns the original archive.

The PNG dimensions locate the actual signature page, including nested PDF
resources. Missing/ambiguous matches fail closed. An internal PDF destination
lets the existing protected admin preview open that section. No scripts,
external image URLs, or new storage/RPC permissions are introduced.

## Consent diagnosis

The user reported the checkbox could not be selected. In the actual synthetic
signing component at 375px width, the old checkbox measured 13x20px. It was not
disabled and browser clicking worked; the exact physical-handset failure was
not reproduced. The corrected native checkbox measures 24x24px, cannot shrink,
and its padded label is clickable. Browser checks verified both checkbox and
label toggling. Local submit validation now explains missing name, ink or
explicit consent instead of leaving an unexplained disabled button. Invalid
submissions make no API request; uncertain retries retain their original data.

## Validation

- 119 relevant tests / 14 files passed, including mouse/touch capture, required
  acceptance, immutable evidence, artifact selection and delivery regressions.
- Build and disposable signature/customer/HAKAFA/delivery database suites pass.
- Linux packaged Chromium with networking disabled: 27 unsigned and 27 signed
  pages; inline signature page 25; 2,099 signature ink channels. Blank-image
  control rejected; no signed CTA; exact unsigned attachment verified.
- Visual inspection confirms Hebrew/RTL acceptance heading, name, ink, time and
  closing text in the inline section. Physical phone/Edge confirmation pending.
- Independent security/spec review: no blockers.

## Production-preserving release plan

Baseline: dpl_7Gy3Rt6SgZ4xLs1n9mTiUGwBwJ6x (198 source files verified).
Overlay only renderer, handler, render-version constant and customer signing UI.
No migration, Edge Function deployment, secret or policy change. Stage without
alias promotion, verify source and protected API, compare all revision/storage/
business/function fingerprints, then promote. Rollback promotes that baseline;
keep all evidence, including any newly signed inline PDFs, intact.

ORD-1044 has signed revisions 1/3, superseded revision 2 and pending revision 4.
None is changed by release or automated testing. Pending revision 4's snapshot
hash and revision binding were verified read-only. Do not create another QA
revision automatically. Production Verified remains withheld until user QA.

## Release receipt

- Runtime commit: `514735bf85c47d7302698077e4d28208cda16863` (local only).
- Deployment: `dpl_6pzSe9vsoSAFH6GKoeUnQK1XFamg`, promoted
  2026-10-11 16:57:39 UTC after protected staged API/source verification.
- Exactly four runtime source files overlaid; 194 preserved unchanged.
- Non-sending production checks passed: public page 200, invalid capability
  404, unauthenticated staff 401, anonymous direct table/RPC 401.
- Revision/storage fingerprints, all public database functions, 35 business
  tables, Edge Functions, environment metadata and Git-source policy unchanged.
- Read-only admin UI confirms revision 4 still awaits signature, 1/3 remain
  signed and 2 superseded. No new revision or signature was created by release.
- No migration, email/WhatsApp send, provider call, Git push or main merge.
- Physical-phone/Edge final UX confirmation remains **PENDING**.
