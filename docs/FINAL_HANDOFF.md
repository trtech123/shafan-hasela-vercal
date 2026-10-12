# Shafan Hasela — authoritative handoff and operating runbook

Owner-approved closure scope: 2026-10-12. This document supersedes conflicting operational instructions in `PROGRESS.md`, `NEW_SESSION_START_PROMPT.md`, `pelecard-rivhit-activation.md`, `icredit-clubs-operations.md`, old plans and historical release notes. Those files remain historical evidence, not permission to activate providers, replay migrations or deploy. Later explicit owner instructions take precedence.

## Release identity and evidence boundaries

- Canonical main and origin/main at preparation: `8d06f6ca0bfa6db1e68f40b3b19a3fead0df159d`.
- Incorporated production chatbot commits: `71ce9e3` (documents), `1bdb22a` (stale handoff), `8d06f6c` (natural entry).
- Production Supabase: `shafan-hasela`, project `divzxsynczeifkpnpupl`.
- Production WhatsApp function: `whatsapp-webhook`, version **38 ACTIVE**. All 20 downloaded source files matched canonical main during reconciliation.
- Production frontend alias: `shafan-hasela-vercal.vercel.app`, deployment `dpl_6pzSe9vsoSAFH6GKoeUnQK1XFamg` at the last read-only audit.
- Vercel Git deployment sources are intentionally **BLOCKED**. Last reconciliation attempt `dpl_DEsQkdt7jhPqihNZLFvMBDaBkoLF` remained BLOCKED and was not promoted/retried.
- This cleanup is a **local review candidate**, not a production release. Its UI retirement changes are not deployed yet. Identify its commit with `git log -1 --format=%H` on `cleanup/final-handoff-20261012`; never infer that commit is deployed from its presence in Git.
- Record the actual commit, reviewed file manifest and deployment ID in a later authorized release receipt. Do not rewrite historical receipts to imply new QA.

Status vocabulary: **PRODUCTION VERIFIED** requires actual production acceptance evidence; **SUPPORTED BUT TECHNICAL DEBT** means implemented/deployed functionality with recorded limitations; **WAITING ON PROVIDER** is an external gate; **DEFERRED KNOWN RISK** is an accepted unresolved risk; **RETIRED / UNSUPPORTED** must not be offered or activated.

## Supported product and boundaries

| Area | Status | Supported behavior / evidence limits |
|---|---|---|
| Chatbot menus, natural entry, documents, handoff | PRODUCTION VERIFIED | Real-phone QA and corresponding production records verified. No repeat chatbot QA is required solely for this Clubs UI cleanup. |
| Digital order-confirmation signature | PRODUCTION VERIFIED | Owner confirmed phone signing and visible ink, name and time in the signed PDF. Earlier pending-QA notes are superseded. |
| Authentication, users and roles | SUPPORTED BUT TECHNICAL DEBT | Admin/operations/cashier/instructor roles, admin user provisioning/deletion and role protection exist. This is not a clean authorization signoff; see accepted risks below. |
| Activities, products, orders, instructors and schedule | SUPPORTED BUT TECHNICAL DEBT | Existing operational screens preserved. Product/admin Hook-order debt and legacy instructor authorization remain. |
| Holidays and blocking | SUPPORTED BUT TECHNICAL DEBT | Existing block rules preserved. Hebcal failure may omit holiday annotations; do not treat annotations as authoritative booking availability. |
| Quotations and conversion | SUPPORTED BUT TECHNICAL DEBT | Existing lifecycle and quote-to-order snapshots preserved. Deployed/tested evidence does not replace missing business acceptance records. |
| Quotation and order PDF/email/WhatsApp | SUPPORTED BUT TECHNICAL DEBT | Canonical PDF and delivery/revision/history paths retained. Use existing authorization, delivery claims and uncertain-state protections. |
| Customers / VAT / snapshots | SUPPORTED BUT TECHNICAL DEBT | Reusable customer master and explicit VAT state; historical customer/quotation/voucher snapshots must not be replaced from current master data. |
| Cash registers / GENERAL / cheques | SUPPORTED BUT TECHNICAL DEBT | Existing register and cheque/split-payment recording. GENERAL is retained. Recording a payment is not proof of invoice issuance. |
| HAKAFA vouchers / signatures / history / report | SUPPORTED BUT TECHNICAL DEBT | Existing immutable signed voucher and report flows retained. Recover an uncertain save by lookup; do not create a second voucher automatically. |
| Clubs and Attendance | SUPPORTED BUT TECHNICAL DEBT | Club setup/edit, weekly rules, participant registration, membership records, sessions and attendance remain. Admin correction rules and instructor links remain unchanged. Some historical instructor/correction QA receipts are incomplete. |
| Pelecard one-time payments and transaction retrieval | SUPPORTED BUT TECHNICAL DEBT | Existing order-authoritative one-time payment flow and admin-only retrieval remain unchanged. Provider success does not certify invoice completion. |
| Accounting preparation / holds | SUPPORTED BUT TECHNICAL DEBT | Preserve holds, preparation and reconciliation. Never clear a hold or retry uncertain issuance merely to make a dashboard green. |
| Payper invoice/document solution | WAITING ON PROVIDER | **WAITING ON EXTERNAL PROVIDER**: Pelecard/provider activation is outstanding. Excluded from this cleanup; no production Payper action. |
| Rivhit | SUPPORTED BUT TECHNICAL DEBT | Bookkeeping/accounting only in the supported architecture, **not invoice issuance**. Legacy issuance-capable code is not permission to enable it. |
| iCredit recurring payments | RETIRED / UNSUPPORTED | No enrolment, payment page or provider cancellation in supported application UI after this candidate is released. No replacement recurring-payment implementation. |

## iCredit retirement: exact scope

Before cleanup, `Clubs.jsx` used a constant-false flag to hide enrolment, provider cancellation and payment-linked attendance. Dead handlers could still invoke `club-recurring-enroll` / `club-recurring-cancel` and open the TEST provider URL. Automatic billing copy and a provider-first cancellation promise remained.

This candidate removes the dead handlers, hidden controls, obsolete payment-attendance panel and flag. It stops loading the unused payment-attendance view and agreement join. The normal `/club-attendance` and `/instructor-attendance` routes and their code are unchanged. It explains that registration does not initiate recurring payment and marks old payment follow-ups as historical.

The existing admin-only `request_club_membership_cancellation` RPC remains an **internal request** with the same effective-date calculation. It records `cancellation_scheduled`; it does not call a provider, refund money or guarantee final provider cancellation. The UI now states that distinction. Membership history, payment history, debt values, historical dates and read-only billing-day schema compatibility are retained. Do not claim this action completes cancellation of an external financial agreement.

Participant registration continues to save participant/membership data only. Monthly-price and fixed billing-day data are preserved for compatibility; they do not activate collection. Historical pending/provider statuses are not rewritten. No operational session, membership or attendance behavior is replaced.

Preserved obsolete backend: `club-recurring-enroll`, `club-recurring-cancel`, `club-recurring-ipn`, their shared helpers, historical migrations and tests. They remain deployed legacy endpoints, **not physically decommissioned or newly authorization-hardened** by this task. Normal supported UI has no route or action invoking them. The latest audit found no ICREDIT secret configuration. Do not configure credentials, invoke these endpoints, promise provider cancellation, or expose them in future supported screens. Historical provider obligations, if any, require owner review outside this application; this cleanup does not cancel them.

The error-state demo view remains explicitly labelled as a demo; it is not production evidence or a payment capability. Provider activation is absent there too.

## WhatsApp/chatbot operations

Inbound Meta events enter the signature-validated webhook and durable event-claim flow. Preserve authentication, idempotency and terminal uncertain-send handling. No fabricated inbound messages and no automatic resend after an uncertain attachment outcome.

- Entry/main-menu ordinary unmatched text shows welcome/main menu; no unknown-question handoff.
- Invalid input inside a menu repeats that menu with Hebrew clarification; no attachment or unintended handoff.
- Explicit topic/package selection gates each allowlisted attachment. No documents from greeting, generic size/pricing/directions/safety or unrelated flows.
- D2–D10 use the server-side manifest in `supabase/functions/_shared/chatbot/assets.json` and matching `_deployed_shared` copy. D1 is empty/excluded; missing meal/supplementary documents must not be invented.
- Private `chatbot-assets` objects are retrieved server-side and delivered through Meta media/document sending. Never publish Storage URLs or commit customer binaries.
- Preserve Berko/Acre, D3/D9, D6/D9 and student/organizational resilience distinctions. A brochure is not an availability confirmation.
- Unclaimed `awaiting_human` handoff under ten minutes suppresses automation. At ten minutes or more, the next real inbound can atomically close it, preserve history, clear stale state and send reset/main menu once.
- Claimed/owned human conversations never auto-expire; use the existing explicit bot-resume workflow.

Real QA verified D9 `מרוץ למטמון_ברקו.pdf`, one attempt, provider `delivered`, phone receipt/opening, size selection and intended handoff. Claimed-lock/concurrency/replay protections have local automated proof; no synthetic production replay was performed.

## Documents, signatures and communications

Use dedicated quotation/order delivery flows and their frozen revisions. Preserve PDF/email/WhatsApp authorization, durable claims, provider IDs and accepted/failed/uncertain states. An uncertain delivery must be inspected before an explicitly authorized retry.

Order signing is separate from billing completion. Preserve the four signature migrations `202610110001`–`202610110004`, optional historical signer-ID data, signed artifacts and private `order-signatures-private` bucket. Do not regenerate an old signed document from mutable current order data. Staff internal notes must stay out of customer documents.

Gmail SMTP is the existing email transport. Meta/WABA template/configuration changes require their own authorization. A configured credential or an ACTIVE function does not prove delivery; only the matching provider/customer evidence does. Never send customer messages as a release smoke test without explicit permission.

## Accepted deferred authorization/security risks

**Owner explicitly accepted these as DEFERRED KNOWN RISK for this handoff. They are not resolved, mitigated by this cleanup, or reclassified as safe.**

| Severity | Unresolved production finding |
|---|---|
| High | `dashboard_stats`, `instructor_schedule`, `sales_summary` are owner-privilege legacy views readable by anon; base-table RLS does not protect those reads. Read-only role/count checks confirmed access. |
| High | `get_my_instructor_id()` links mutable `profiles.email` to instructor email. Self-profile email update can cross the intended instructor identity boundary. Prior isolated regression reproduced the bypass; production prerequisites remained present. |
| High | Instructor order SELECT exposes excessive data; the “update notified” policy restricts rows, not writable columns. Financial/internal fields have broad authenticated column grants. |
| Hardening | Some legacy SECURITY DEFINER helpers lack a fixed search path. This is separate from the confirmed vulnerabilities. |

The uncommitted security worktree `fix/legacy-view-authorization` and migration `202610080001_legacy_view_authorization.sql` are **not part of this release**. Do not apply that candidate. Its own full gate failed on the identity bypass; view-only changes are not a completed security closure. Preserve its findings and history. Only a separately authorized security task may change these boundaries.

The owner is the risk-acceptance authority; the maintainer must surface these risks again before expanding access, onboarding new privilege classes or advertising a security-complete system. Acceptance is not evidence that unauthorized access cannot occur.

## Technical debt and evidence

Known repository-wide TypeScript/lint failures were accepted as baseline debt for the chatbot Git reconciliation. The differential comparison found no new diagnostics from its three commits: candidate 222 TypeScript diagnostics versus 223 in the older local-main environment, whose extra diagnostic was a missing local `pdf-lib` dependency. Six lint findings comprised three unused imports and three conditional-Hook errors. Do not repair unrelated debt in this cleanup or silently widen that exception to new failures.

Conditional Hooks in Products/Templates/Users can represent runtime risk during role changes; they are not merely cosmetic. Much of the other JSX/PromiseLike/optional-parameter typing output requires classification rather than assumed runtime failure. Repository-wide tests historically contain baseline failures; focused green suites are not a claim of a universally green repository.

Recent verified chatbot baseline: 282 tests / 22 suites, build, Deno checks, 28 stale-handoff SQL checks, 18 document SQL checks and three PostgreSQL race checks. Signature and earlier production release receipts remain evidence for their own scope. This cleanup's commit is a local candidate until a separate deployment/acceptance receipt exists.

## Configuration and ownership

| Responsibility | Authority / location |
|---|---|
| Business scope, prices, accepted risks, release approval | Project owner; record explicit approvals. |
| Git, build, Supabase schema/functions and deployment manifests | Authorized maintainer under owner approval. |
| Pelecard terminal and Payper activation | Owner coordinates with Pelecard/provider; no guessed contract/configuration. |
| Accounting meaning and bookkeeping setup | Owner/accountant; cannot repurpose Rivhit as invoice fallback. |
| Meta/WABA assets and Gmail sending identity | Owner-controlled provider accounts; maintainer only through authorized workflows. |
| Credentials | Supabase/Vercel/provider secret stores as appropriate; never Git, runbooks, browser bundles, logs or screenshots. |

Frontend may contain the public Supabase URL/anon key only; service-role and provider credentials are server-side. Never print secret values. Check names/configuration readiness without treating presence as proof of operational correctness. Test/controlled-live/payment/refund gates are independent; never enable them through a bulk secret restore. The last audit found live one-time payments enabled, test/controlled-live disabled and refunds disabled; recheck before any relevant future release rather than assuming these values remain current.

## Supabase migration process

This project historically uses **targeted/manual production migrations**, not a reliable Supabase internal migration ledger. `supabase_migrations.schema_migrations` is absent by design/history: do not create, seed, fake or repair it. Do not use blanket migration push.

Canonical inventory has 59 uniquely identified SQL files, including optional commented normalization proposals. The latest audit found all 220 current declared relation/function/view names after accounting for comments and superseded objects. Names alone do not prove complete function-body/grant parity.

Installed chatbot migrations `202610120001_chatbot_document_delivery.sql` and `202610120002_chatbot_stale_handoff.sql`, UUID migration `202610090001_chatbot_uuid_resolution.sql`, signature and attendance migrations must not be replayed just because a ledger row is absent. Preserve exact historical bytes. Before any new targeted migration compare live prerequisites, definitions, permissions, constraints and markers; rehearse locally, obtain approval, apply only the reviewed transaction and verify immediately. This cleanup requires **no migration**.

## Safe future release procedure

1. Confirm scope and explicit release authorization. Inspect canonical main/remote, clean isolated worktree, commit and exact diff. Do not merge historical workstreams wholesale.
2. Recheck production identity/source, Git-to-production correspondence and intended environment. Treat a mismatch as a stop condition.
3. Run relevant tests/build/static checks. Compare known baseline debt; new failures need investigation. Check that no unrelated providers, webhook/signature files, migrations, binaries or secrets entered the diff.
4. Check migration ID uniqueness and whether SQL is needed. For this cleanup, none is needed; no Edge Function or Storage change is needed either.
5. Vercel Git auto-deployment remains **BLOCKED**. Never restore it as a convenience. A later authorized push may create a BLOCKED attempt: leave it blocked, do not promote/retry it.
6. Any production frontend deployment requires a separate, explicitly authorized release from the reviewed commit/artifact, preserving existing Vercel configuration. Deploy only the reviewed frontend change, not the dirty original workspace. Git reconciliation alone is not deployment.
7. Verify uploaded source/manifest, deployment/alias and unchanged Edge Function versions, provider boundaries and configuration. Perform no-write/no-send checks; real operational QA requires its own authorization.
8. Record actual production deployment and acceptance results. Keep prior artifact available; any rollback is separately authorized. Retain all historical data/migrations and do not restore the retired provider actions casually.

## Proposed release of this local cleanup

Review this commit and the exact Clubs UI diff. Recheck current main and deploy state before choosing a later integration method; do not assume a fast-forward remains possible. After separate authorization, integrate/push only this candidate and preserve blocked Git deployment policy. Separately deploy the reviewed frontend artifact using the established manual controlled process. Do not redeploy any Edge Function, apply SQL, upload assets, configure providers or retest the production bot for this change.

Read-only UI acceptance: club list/details, historical status/debt/follow-ups, club edit and participant-registration dialogs, cancellation-request explanation, links to admin/instructor attendance, and absence of provider actions. Cancel dialogs without saving unless real writes are separately authorized. Verify no provider call appears in network activity. Local tests cover internal cancellation saves and operational regressions without production writes.

## Closure under the revised owner-approved scope

The chatbot/signature production verification remains valid. Security issues remain accepted **DEFERRED KNOWN RISK**. Payper remains **WAITING ON EXTERNAL PROVIDER**. iCredit is **RETIRED / UNSUPPORTED**; this candidate removes its application remnants without deleting history or replacing recurring billing. Production adoption of this candidate remains pending review and separate release authorization.

## Local cleanup verification receipt

Changed files: `app/src/pages/Clubs.jsx`, `app/src/pages/Clubs.test.jsx`, `app/src/components/clubs/ClubFormDialog.jsx`, this runbook and the root `README.md` entry point.

- New retirement tests first failed on the retained provider handlers and missing clarification, then passed after removal.
- Clubs/Attendance: **63 tests in eight suites passed**, including forms, local cancellation-request behavior, admin/instructor attendance and migration contracts.
- Chatbot/WhatsApp regression: **282 tests in 22 suites passed**. These were local tests with mocked providers, not new production QA or real messages.
- Application build passed; existing Browserslist age warning remains.
- Focused ESLint on the three changed application/test files passed. The first invocation used the repository root without the app's ESLint config; the corrected invocation from `app/` passed. No unrelated lint/type cleanup was performed.
- `git diff --check` passed. Protected-path comparison with `8d06f6c` showed no changes to Supabase/migrations, app server/API/payment logic, shared libraries, attendee screens, order components, participant registration logic, package manifests or Vercel configuration.
- Historical due cancellations expose no provider-finalization control; application source scan prevents restoring retired provider endpoints/payment URLs. The internal cancellation-request test verifies no provider invocation or browser payment window.
- No production calls, deployments, migrations, Storage writes, provider configuration, financial records or customer messages were performed by this cleanup. No Git push or merge.
