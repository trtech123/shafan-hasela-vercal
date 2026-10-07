# Production-to-main reconciliation, 2026-10-07

Verified production: `dpl_6XPouByDuARH9GzBkTe4cxGxr1vo`.
Main before reconciliation: `2a0c7f5d7e777e044c8d5281c0bd60a3c21a840b`.
Candidate branch: `reconciliation/production-main-20261007`.

## Scope and provenance

The candidate descends from main through the ten reviewed Clubs release commits ending at `34eeea7`, preserving their history. Their latest application source matches production except for release-branch deployment metadata; that metadata was replaced with the actual production `app/vercel.json`. All 185 working artifact files were verified against the live deployment upload hashes. Git text normalization accounts for CRLF/LF differences in stored blobs.

Main lacked 56 deployed application files and had older content in 23 others. These include payment/retrieval infrastructure, customer/VAT/voucher features, quotation/order delivery, accounting controls, and all Attendance releases. There were no additional main-only application runtime paths; `app/.gitignore` is repository-only. Full per-branch path comparisons are in the matching source-audit JSON.

The production backend was independently downloaded read-only. All 26 Edge Functions are represented by exact source snapshots and reconstructed runtime dependency graphs. Eight shared-module paths have divergent versions in deployed bundles. Per-function `_deployed_shared`/`_deployed_functions` directories preserve those versions; 108 relative import paths are relocated across 205 files, with no other runtime logic edits. All 26 graphs bundle locally. JWT settings match the live function metadata. Erased type-only dependencies and reconstruction instructions are documented in `docs/production-source/edge/README.md`.

`pelecard-refund` existed on main but is not deployed. Its source was preserved under `supabase/undeployed`, outside deployable functions; its historical test now reads that archive. Other main-only files are type declarations, unused legacy helpers and documentation retained for existing tests/history. They do not replace any captured runtime dependency.

Twenty historical migrations missing from main were restored from committed verified production history (`feat/simple-delivery-ui`, commit recorded in provenance JSON). All their declared public object markers exist in production. The four installed Attendance migrations and release records remain intact. Migrations 029 and 043 were not invented or imported. All 52 available migrations rehearsed successfully in a disposable local database. No production migration was applied.

## Validation

- Production frontend build: PASS.
- Exact frontend artifact: 185 files matched.
- Backend reconstruction: 26 graphs / 205 runtime files verified; 26 local bundles passed.
- Clubs/admin/instructor/manual/correction DB checks: 147 passed.
- Local migration rehearsal: 52 migrations; customer/VAT, order save, quotation lifecycle, order confirmation and delivery acceptance SQL suites passed.
- Accounting component/model tests: 30 passed.
- Full application suite: 631 passed, 27 unchanged baseline failures. Restoring actual production Edge source exposed an obsolete `capability_unconfigured` assertion. That assertion also failed on untouched live-source downloads; it was updated to verify the deployed guard runs before runtime construction and actually throws `capability_disabled`. No production runtime code was changed to satisfy a test.
- Provider tests against hash-identical production source: 56 passed, four previously documented pre-live/document-metadata expectations fail unchanged.
- Typecheck: 203 diagnostics, identical to the verified production baseline.
- One UI lookup timed out in an unbounded parallel run; the bounded rerun passed that test. The completed-correction test was not weakened.
- No production data/user/link/attendance changes, deployment, migration application, financial operation, or external payment/accounting provider invocation.

## Push gate

Vercel is linked to `trtech123/shafan-hasela-vercal`, production branch `main`, with `gitProviderOptions.createDeployments = enabled`. A main push can automatically create a production deployment. No Vercel settings were changed, no reconciliation branch was pushed (it could create a preview deployment), and origin/main must remain unchanged until this gate is explicitly resolved.

Safe next action: temporarily disable automatic Git deployment creation for this Vercel project, verify it is disabled, recheck the current production identity and origin/main, then push the verified local main by fast-forward only. Do not deploy or promote anything to synchronize Git. Re-enabling Git deployment creation is a separate explicit operational step.
