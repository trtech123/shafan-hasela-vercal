# Main / Production reconciliation audit — 2026-11-18

## Protected baseline and decision

- Deployed Vercel application source: `73690eee338b400bd9310e8fb283806852f43f29` on `feature/optional-customer-details-20261117`.
- Audited GitHub `main`: `557f8eb6b59fdff7a7786e1bf6baeebff2ffbd7b`; common ancestor: `2a0c7f5d7e777e044c8d5281c0bd60a3c21a840b`.
- Divergence: 34 main-only and 149 production-only commits. A three-way text merge reports 27 paths changed on both sides and many overlapping hunks. Neither a broad merge nor a tree-wide preference is safe.
- This candidate changes documentation only. Its application, migrations, Edge Functions, payment code, Vercel settings and deploy script are byte-for-byte identical to the protected baseline. No main-only runtime feature is silently declared restored.
- Historical release receipts in `main` report prior production releases. They are evidence of intended behavior, not proof that the current Vercel artifact or independently deployed Supabase Edge Functions still expose it. Reconcile those surfaces separately before activation.

## All 34 main-only commits

Status: **restore** = important behavior absent from the current Vercel source; **pending** = dependency/activation decision needed; **equivalent** = current source already has the operational control; **record** = historical evidence only; **unsafe bulk** = do not replay wholesale.

| Commit | Function introduced or recorded | Status and dependency |
|---|---|---|
| `7fb45af` | Versioned club sessions and attendance admin RPCs | restore; migration `202610050001` is in both trees and recorded as applied |
| `2e7903d` | Admin attendance workspace/history and route | restore; current Vercel source lacks `ClubAttendance` and `clubAttendance` client |
| `1331256` | Explicit instructor-user links and instructor attendance RPCs | restore; migration `202610050002` is in both trees and recorded as applied |
| `470c59b` | Instructor attendance page, identity linking, instructor role creation | pending; `Users`, `Layout`, `App` and `create-user` permissions differ from current source |
| `7ca9ae0` | Reconciled attendance release source with then-live artifact | unsafe bulk; 73-file source overlay also includes customer CRM, vouchers, quotation delivery and older payment/checkout files |
| `8b37508` | Attendance production rollout receipt | record; confirms targeted migration and Edge deployment history |
| `25d3365` | Admin-created manual club sessions; hides obsolete iCredit UI | restore/pending; migration `202610060001` is in both trees; `Clubs` conflicts |
| `54ceae6` | Manual-session rollout receipt | record |
| `a4385a2` | Audited corrections to completed attendance sessions | restore; migration `202610060002` is in both trees; client workflow missing |
| `34eeea7` | Completed-session correction rollout receipt | record |
| `322c8f8` | Reconciled older deployed source and dependency versions | unsafe bulk; changes 363 files, including customer/voucher/quotation source, payment/Edge snapshots and dependencies |
| `ab53faf` | Immutable order-confirmation signing, server renderer, public page and mail function | restore; current Vercel source lacks signing API, page and renderer |
| `68b900d` | Signature packaging and mobile QA harness | pending test support; depends on signing runtime |
| `e4de27e` | Initial signature release receipt | record |
| `1d10f7b` | Signer-ID evidence and embedded PDF ink | restore; migration `202610110002` is in both trees |
| `4110199` | Signer-ID release receipt | record |
| `7ad6fc7` | Separates billing readiness from signing identity | restore; migration `202610110003` is in both trees; conflicts with newer optional-customer order form |
| `24cdd41` | Historical signer-ID migration test | pending test support |
| `b1034a9` | Frozen confirmation snapshot renderer correction | restore with signing renderer |
| `0b5f398` | Signing UI refresh error handling | restore with signing UI |
| `3113019` | Billing/signature release record | record |
| `3f4f140` | Preparation without billing prerequisites | restore; migration `202610110004` is in both trees and reported applied |
| `718304f` | Simple signature flow release record | record |
| `1028dc7` | Archived signed confirmation visibility | restore; PDF and order UI adaptation required |
| `55a694a` | Visible-artifact release checks | record |
| `c18811d` | Signature ink in acceptance section | restore; renderer and PDF behavior must remain compatible with historical revisions |
| `e039413` | Inline signature release record | record |
| `ed4d0c9` | Verified physical-phone signature QA and reconciliation | record; important evidence of prior production behavior |
| `9441909` | Qualified UUID generation in chatbot event claim | equivalent schema; `202610090001` is byte-identical in both trees, current Edge deployment needs separate verification |
| `71ce9e3` | Private brochure delivery in WhatsApp chatbot | pending; release notes say it was not deployed, despite migration file in both trees |
| `1bdb22a` | Stale unclaimed handoff recovery | pending; depends on chatbot delivery/state machine and `202610120002` |
| `8d06f6c` | Navigation after unrecognized chatbot input | pending; changes shared and bundled webhook state machines |
| `086da7f` | Removes obsolete iCredit UI and clarifies no automatic club charge | pending financial-UX decision; current source still exposes TEST enrollment/cancellation buttons, so this is not equivalent |
| `557f8eb` | Disables Git auto-deploy and adds manual Vercel deployment script | equivalent/superseded; current source retains the guard and has newer Windows/root-packaging corrections |

## Runtime and operational dependencies

| Feature | Existing source/schema evidence | Required before restoring behavior |
|---|---|---|
| Club attendance | Four `20261005/06` migration files are byte-identical in both Git trees. `main` receipts report all four applied and prior admin/instructor attendance releases. Current Vercel source lacks admin/instructor pages, `clubAttendance` client, identity-link UI and manual-session UI. | Read-only verify production RPCs/RLS and current Edge `create-user` version; preserve admin/cashier roles and current `Layout` navigation. Instructor role creation is a permission expansion requiring explicit release review. Exercise admin/instructor authorization, optimistic versions, corrections, archive behavior and existing club workflows. No migration replay. |
| Order signatures | All four `202610110001–004` migration files are byte-identical in both trees; `main` records production verification and private stored evidence. Current Vercel source lacks `/order-sign`, `/api/order-confirmation`, renderer and signature panel. | Port surgically around current `OrderFormDialog` optional details and current PDF. Add `@sparticuz/chromium`, `puppeteer-core`, `pdf-lib` without removing current Vite, J4 queue or pinned jsPDF dependency; add only signature function/header settings to current `vercel.json`. Verify existing `ORDER_SIGNATURE_PUBLIC_ORIGIN`, `SUPABASE_URL`, service role and independently deployed `send-order-signature` Edge function before release. Preserve immutable historical revisions, private bucket/RPC permissions and no billing prerequisite. Do not replay migrations or create a live signature during code reconciliation. |
| Chatbot UUID | Matching migration exists in protected source; current Edge runtime is separately deployed from Vercel. | Read-only verify the live RPC and webhook source/version before declaring runtime equivalence. No migration replay. |
| Private chatbot documents | `202610120001/002` files exist in both Git trees, but `main` release-preparation notes explicitly say no production migration, private asset upload, webhook deployment or real-message acceptance had occurred at that point. | Verify actual live migration/RLS, private Storage bucket, nine approved asset hashes/uploads, Meta credentials and webhook bundle/version. Reconcile at-most-once attachment claims and uncertain sends before enabling; requires a separate approved Edge/asset release. Do not merge source as if it were active. |
| iCredit cleanup | Current `Clubs.jsx` still renders `הוראת קבע` and `השלמת ביטול ב־iCredit` buttons, invoking `club-recurring-enroll` and `club-recurring-cancel`; the enrollment URL is constrained to `testicredit.rivhit.co.il`. Main removes those actions and states that automatic club charging is unsupported. | Treat as a separate financial-UX decision. Verify whether any authorized staff still rely on the TEST path before removal; never turn on recurring collection or remove historical data. The main cleanup also removes read-only legacy attendance/payment display and overlaps attendance work, so do not cherry-pick its whole `Clubs.jsx`. |
| Vercel control | Current source has `git.deploymentEnabled=false`, physical queue/cron functions and corrected root-packaging deploy script. | Preserve current `app/vercel.json`, `.vercelignore` and `scripts/vercel/*`; do not replace with older main copies. |

### Other application modules absent from the current deployed tree

The final-tree comparison finds **64 `app/` paths present only on main**, including tests and assets. In addition to attendance and signatures, the non-test paths group as follows. These are not safe to call equivalent merely because some tables or API routes remain. The large `7ca9ae0` and `322c8f8` commits carried older production snapshots; their historical deployment provenance needs review by feature, not replay as a unit.

| Missing main-side module | Current-source evidence and disposition |
|---|---|
| Customer management (`Customers.jsx`, customer/delivery helpers) | Current source retains customer selection and order links but has no `/customers` route. CRM list/edit behavior is missing. The matching `041_customers_and_hakafa_vouchers.sql` and `044_order_form_customer_save.sql` files exist in both trees; verify live customer RLS and `archive_customer` RPC before a separate UI slice. |
| Cafe vouchers (`Vouchers.jsx`, voucher components/helpers) | No current `/vouchers` route. Files `041`, `042` and `045` are in both trees, but live voucher RPC/RLS and `voucher-accounting-email` Edge configuration need verification. Financial balance, redemption and document behavior require an accounting review before restoring. Do not treat legacy vouchers as cash/POS equivalents. |
| Quotation and order delivery (`QuoteDeliveryPanel`, `OrderDeliveryPanel`, `DeliveryButtons`, `ResendConfirmation`, quotation snapshot/PDF helpers) | Current quote/order screens have newer save and payment guards. Migration files `046_quotation_lifecycle.sql` through `050_manual_delivery_resend.sql` match, but the protected source lacks `send-quote-email` and `send-quote-whatsapp` Edge source; `send-order-doc` is present with a different bundle. Verify actual deployed functions, destination permissions and SMTP/Meta configuration before porting; sending could affect real customers. |
| Immediate accounting (`ImmediateAccountingPanel`, `immediateAccounting.js`) | Current accounting screen is Payper-centric; the missing panel invokes `rivhit-immediate-accounting`, whose Edge source remains in the protected tree. Older Rivhit/immediate controls may be superseded. Decide product/provider authority before restoring any dispatch UI. |
| Pelecard transaction administration (`PelecardTransactions.jsx`, `pelecardTransactions.js`) | Current `api/pelecard-transactions.js` route exists but admin page/route does not. Compare its authorization and retrieval scope with current pending-payment review before restoring read-only transaction tools. |
| Payment-return continuity (`payment-continuation.js`) | Current login and return routes differ. Verify return/recovery behavior and auth redirects before porting. |

The main-side `Customers`, `Vouchers` and delivery screens are **important missing capabilities or evidence**, not approved changes to the protected runtime. Their exact migration history and live Edge state must be verified individually; they are additional blockers to claiming all important main functionality is reconciled.

## File-level conflict map (all 27 paths changed on both branches)

The `main` side includes historical attendance/signature/quotation source; the protected side includes newer checkout, Payper, J4, order and Vercel changes. Each row requires an explicit port or a documented decision, never automatic whole-file resolution.

| Path | Main-side intent / protected-side risk | Resolution boundary |
|---|---|---|
| `PROGRESS.md` | Divergent release narratives | Keep both as historical evidence; write a dated reconciliation record |
| `app/package-lock.json` | Chromium/PDF signing dependencies versus current Vite/J4 versions | Regenerate lock only after a targeted dependency plan |
| `app/package.json` | Signature packages versus physical queue and current build/test scripts | Add dependencies, do not replace manifest |
| `app/src/App.jsx` | Attendance/signature routes versus current POS, physical and payment-return routes | Add guarded routes surgically |
| `app/src/components/Layout.jsx` | Attendance nav and roles versus current Payper/Pelecard alerts and physical settings | Add role-scoped links only; retain existing alerts/routes |
| `app/src/components/Layout.test.jsx` | Role/navigation expectations differ | Combine assertions for all roles/payment links |
| `app/src/components/cashregister/Cart.jsx` | Earlier customer and cart behavior versus optional-customer POS | Retain protected checkout; port only independently needed behavior |
| `app/src/components/cashregister/PaymentScreen.jsx` | Earlier payment UI versus hosted Pelecard, cash and Direct J4 | Protected payment path is authoritative; do not transplant older file |
| `app/src/components/orders/OrderConfirmationPDF.jsx` | Inline signed PDF work versus current combined document | Preserve immutable revisions and current document behavior in an explicit renderer adaptation |
| `app/src/components/orders/OrderConfirmationPDF.test.jsx` | Signature cases versus current document tests | Reconcile fixtures and cover both flows |
| `app/src/components/orders/OrderFormDialog.jsx` | Signature/billing changes versus optional details and schedule conflict guards | Port signature entry only after customer and scheduling tests |
| `app/src/components/quotes/QuoteFormDialog.jsx` | Historical quotation lifecycle versus current order/quote workflows | Review field-level diff; keep current save guards |
| `app/src/components/quotes/QuotePDFDocument.jsx` | Older document renderer versus protected quote PDF | Verify output parity before any port |
| `app/src/pages/AccountingOperations.jsx` | Earlier accounting screen versus current Payper controls | Preserve protected Payper screen |
| `app/src/pages/CashRegister.jsx` | Earlier standalone register versus current POS/order collection | Preserve protected cashier tree |
| `app/src/pages/Clubs.jsx` | Attendance/manual session/iCredit cleanup versus current club UI, which still exposes TEST iCredit actions | Port attendance access and non-charge messaging surgically after separate financial-UX decision |
| `app/src/pages/Clubs.test.jsx` | Manual-session/iCredit expectations versus current tests | Run combined club regression suite |
| `app/src/pages/Dashboard.jsx` | Earlier operational links versus current dashboard | Avoid replacing newer status widgets |
| `app/src/pages/Login.jsx` | Earlier payment-return continuity versus current login | Verify redirect contract before any change |
| `app/src/pages/Orders.jsx` | Signature history/actions versus current archive, payment and optional details | Add signature panel without changing order actions |
| `app/src/pages/Quotes.jsx` | Historical quote delivery versus current quote screen | Preserve current delivery state/actions |
| `app/src/payments/edge/pelecardHandlers.test.js` | Historical Edge fixtures versus current payment contracts | Keep current payment assertions; add only applicable legacy coverage |
| `app/vercel.json` | Signature API/header versus protected physical queue, cron and Git guard | Append signature settings only after runtime validation |
| `supabase/config.toml` | Older Edge deployment declarations versus current configuration | Verify named functions; do not bulk-replace |
| `supabase/functions/pelecard-callback/index.ts` | Older bundled callback versus current payment finalization | Preserve protected callback and reconciliation semantics |
| `supabase/functions/pelecard-initiate/index.ts` | Older initiation path versus current provider controls | Preserve protected idempotency and gates |
| `supabase/functions/pelecard-verify/index.ts` | Older verification path versus current financial reconciliation | Preserve protected verification and document guards |

## Safe integration sequence

1. Keep `73690eee` as a protected tag/branch and keep this integration branch rooted there. Do not deploy or merge until a candidate is verified.
2. Read-only compare actual production attendance/signature RPCs, private storage, Edge versions and Vercel environment metadata with the historical release receipts. Resolve mismatches before porting UI.
3. Inventory customer CRM, cafe vouchers, quotation/order delivery and Pelecard transaction administration as separate slices. Identify which are still operationally required; verify their current database and Edge prerequisites before porting. Keep immediate Rivhit accounting pending an explicit provider-authority decision.
4. Restore club attendance as an isolated slice: add client/pages/tests, then adapt `App`, `Layout`, `Clubs`, `Users` and `create-user` only with explicit permission review. No migration replay. Test admin, instructor and cashier roles.
5. Restore signatures as a separate slice: port server/PDF code, dependencies and routes; preserve current optional-customer form and protected payment paths. Rehearse historical-revision replay and private access before any release.
6. Treat private chatbot document delivery as a separate pending Edge/Storage release. Reconcile UUID, stale handoffs and natural navigation on the current webhook source; do not send a real message in this workstream.
7. Compare each runtime slice against `73690eee`; run focused tests plus cashier/order/scheduling/payment regressions, full build and isolated schema rehearsal. Only then prepare a normal merge of histories for review. If desired, first deploy a verified new integrated artifact, then synchronize main to that exact new source; a merge that keeps the old deployed tree would silently discard main-only functionality.

## Verification boundary for this audit candidate

Since no runtime feature is integrated yet, focused feature tests cannot establish signature/attendance/chatbot parity. A clean build and baseline regression tests can establish that this audit commit preserves the deployed source. Do not call the audit branch a release-ready application integration.
