# Clubs + Attendance deployment candidate

## Scope and workspace

Prepared on `workstream/clubs-attendance` from refreshed `origin/main`,
`2a0c7f5d7e777e044c8d5281c0bd60a3c21a840b`, in the isolated
`.worktrees/clubs-attendance` worktree. The original
`workstream/pelecard-test-isolation` worktree had extensive unrelated changes
and was eight commits ahead of main. None of that work was copied, reset,
stashed, committed or pushed by this workstream.

No production deployment, migration, operational/financial write, payment,
provider request, accounting issuance or merge is part of this candidate.

## Audit

Already present in migrations 023/028 and the main branch:

| Area | Existing implementation | Gap addressed |
| --- | --- | --- |
| Clubs | Admin list/create/edit, status, site, capacity | Reused unchanged |
| Weekly rules | Weekday, local start/end, effective bounds, timezone | Bounded dated materialization |
| Instructor | Club-level instructor FK; instructor records | Snapshot and versioned per-session assignment |
| Participants | Reusable participants and contact fields | Names only in operational roster |
| Memberships | Starts/ends/cancellation dates, statuses | Eligibility independent of collection status |
| Sessions | `club_sessions`, unique club/date/start, cancellation status | Generation, editing operational details, audit |
| Attendance | `club_attendance`, present/absent/excused, unique session/membership | Marking/correction UI, optimistic concurrency, audit |
| Admin UI | Read-only attendance/payment projection inside Clubs | Separate operational attendance workspace |
| Authorization | Admin RLS on club/session/attendance tables | Checked RPC writes; direct session/attendance DML revoked |
| Instructor authentication | Role exists, but no instructor-to-profile/user FK | Deferred; no invented identity matching |

Production **read-only metadata/count inspection** confirmed the existing club,
schedule, participant, membership, session and attendance objects and admin
policies. At inspection: **1 club, 0 sessions, 0 attendance records**. The
migration ledger was not readable through the available safe query mechanism;
object presence, not the ledger, was verified. No personal data or secret values
were retrieved for this audit. No staging environment was used.

The existing `club_attendance_operations` view joins recurring billing data.
The new page/RPCs do not use it or any provider/billing table. Existing Clubs
payment buttons and legacy views remain untouched; using them is not required
for attendance. `Clubs.jsx` only gains a link to the new workspace.

## Data and session strategy

One additive migration: `202610050001_clubs_attendance.sql` (timestamp avoids
collisions with unrelated numbered migrations in other worktrees).

* Extend existing sessions with instructor snapshot, Israel timezone, original
  rule snapshot and version; extend existing attendance with version/editor.
* Add `club_session_roster`: immutable participant/membership/name snapshot per
  session, including people who have not yet been marked.
* Add append-only `club_attendance_audit` and `club_session_audit`. Application
  roles cannot directly insert/update/delete these or the roster.
* Revoke direct session/attendance writes. Admin-only security-definer RPCs
  have fixed search paths and explicit `auth.uid()`/admin checks. Public, anon
  and service-role execution grants are revoked. Reads retain admin RLS.
* A session cannot be deleted or have its club/date/time/rule snapshot rewritten.
  Cancellation retains history and cannot be reversed. Club cascades cannot
  erase generated sessions. Archive clubs instead of deleting their history.
* Existing `save_club_with_schedule` replaces rules. Its FK may set the old
  session's rule ID to NULL; the session's frozen schedule snapshot survives.
* Legacy attendance, if present elsewhere, is backfilled into roster snapshots.
  Existing marks/editor timestamps survive; historical audit entries are not
  fabricated. Conflicting legacy memberships for one participant/session fail
  migration atomically rather than lose history.

### Explicit generation

`materialize_club_sessions(club, from, until)` is invoked by a button, never on
mount/refresh. It creates at most a 62-calendar-day window, between one year
back and 90 days ahead of the current Israel date. Inactive clubs cannot generate.
Only active Israel-time rules within effective bounds apply. Without an explicit
effective start, a rule is not projected before its Israel-local creation date.
Dates are date-only and times are wall-clock values in `Asia/Jerusalem`; iteration
does not add 24 hours to UTC instants across daylight-saving changes.

The club row lock and existing unique `(club_id, session_date, start_time)` key
make repeated/concurrent requests safe. Ambiguous rules for the same start time
are rejected. Existing rows, including cancelled rows, are never upserted.
Changing a rule to a different time can explicitly generate a new session at
that time; admins must cancel obsolete already-materialized sessions themselves.
No job, scheduler or automatic historical rewrite was added.

### Roster and attendance

`prepare_club_roster(session)` is also explicit. It adds eligible participants
without deleting or rewriting earlier roster snapshots/marks. Starts/ends are
inclusive; cancellation effective date is exclusive. Pending enrollment, active
and scheduled-cancellation memberships can attend, regardless of payment status.
Ended/cancelled memberships may populate historical sessions only when dated
end/cancellation information proves eligibility. Paused memberships have no dated
pause history, so are excluded when preparing a new roster. A saved roster is
preserved if membership state subsequently changes. Ambiguous overlapping
memberships fail atomically; no arbitrary membership is selected.

`mark_club_attendance` locks the session and requires the exact current version
(zero for the first mark). Updates capture old/new status/notes, actor ID/name,
version and timestamp in the same transaction. A stale or double request cannot
silently overwrite another editor. Notes are bounded to 1,000 characters.
Completed sessions can be corrected with audit; cancelled/future sessions cannot
be marked. Unmarked is distinct from absent.

`update_club_session` uses the same locking/version strategy for instructor,
status and notes. `get_club_attendance_history` is a bounded, read-only projection
with no financial joins. The UI supports club/date/session selection, name search,
participant-ID filtering and per-session change history. It reloads state after
successful or uncertain writes before retrying. No contact/financial fields are
sent to the attendance page.

## UI and permissions

Admin-only `/club-attendance`, Hebrew/RTL, accessible from `נוכחות חוגים` in the
shared desktop/mobile navigation and `מפגשים ונוכחות` in Clubs. Existing form
handles club, weekly-rule and club-instructor management. The new screen provides
loading/error/empty states, explicit action buttons, responsive cards, attendance
notes/statuses, last editor/time and history. Mobile sidebar navigation scrolls.

No instructor-facing workflow is shipped: instructor rows have no authenticated
profile identity. A later phase must explicitly establish that relationship and
define assignment-scoped RLS/RPC policies. Instructor, cashier and operations
users currently cannot read/write this feature.

## Validation and limits

* Baseline: 61 application/Edge test files, 620 tests pass with synthetic local
  Supabase settings. Initial clean-worktree run had one environment-only failure
  (`QuotePDFDocument.product.test.jsx`, missing Vite Supabase settings); no source
  change was needed to make it pass.
* Candidate: 62 test files / 633 tests pass, including existing Clubs, Orders,
  Pelecard/payment finalization/refund contracts and accounting suites. These are
  mocked/unit/contract regressions; no real payment/accounting request was made.
* Native PostgreSQL: 55 assertions pass, including real concurrent clients,
  cancellation, schedule replacement, eligibility boundaries, history, audit,
  empty schedules/rosters, multiple clubs, role denial and billing-state fingerprints.
* `npm run build`: passes with synthetic local settings. Existing Browserslist
  data-age warning remains; dependencies were not changed.
* `npm run typecheck`: **175 pre-existing errors**, exit 2. Candidate error output
  matches the baseline exactly; zero introduced errors. This is not a clean
  typecheck claim. Existing React dialog-description warnings remain in tests.
* Local Playwright with synthetic API/auth fixtures: desktop 1440px and mobile
  390px; roster, marking/correction, audit, sidebar navigation, no horizontal
  overflow, no runtime errors, non-admin redirect/hidden link. All external
  requests blocked. This does not substitute for authenticated staging QA.
* Migration rehearsed only in disposable loopback PostgreSQL 18, with the actual
  prerequisite 023/028 migrations and minimal auth/profile/instructor fixtures.
  It has **not** been applied to staging or production or tested against a full
  copy of the deployed database. A same-version staging rehearsal remains a
  release gate.

### Reproduce automated checks (PowerShell)

```powershell
# At the dedicated worktree root. This installs ONLY an ignored test runtime.
npm install --prefix .tmp/clubs-runtime --no-save embedded-postgres@18.4.0-beta.17
node scripts/clubs/attendance.test.mjs

Set-Location app
npm ci --ignore-scripts --no-audit --no-fund
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'
$env:VITE_SUPABASE_ANON_KEY='synthetic-local-test-key'
npm test -- --reporter=dot
npm run typecheck
npm run build
```

The DB script can use `CLUBS_TEST_RUNTIME` to point to an existing package install.
It starts a fresh loopback database on port 55447 with a random, unprinted local
password, never accepts a production database URL, and stops PostgreSQL in `finally`.
Synthetic files remain under ignored `.tmp/attendance-*` for inspection.

## Deployment gates and manual QA

Do not deploy this main-based branch wholesale over the current production
release: unrelated production work exists outside this baseline. Reconcile this
feature's scoped commits with the verified production release in a separate
approved release process. Keep existing payment/accounting behavior intact.

Before approval, use an explicitly identified isolated staging database with all
provider/accounting integrations disabled. Apply the prerequisite migrations and
this migration there, then use synthetic clubs/participants only:

1. Sign in as admin. Open **חוגים → חוג חדש**. Create a zero-price synthetic club,
   assign an instructor, add today's weekday and a valid daytime start/end, save.
2. Use the existing participant registration UI to add two synthetic memberships
   starting today. Do not click any recurring-payment/enrollment/provider button.
3. Click **מפגשים ונוכחות**. Confirm the **נוכחות חוגים** sidebar entry is active.
   Select the club; set today through seven days ahead; click **רענון מפגשים**.
   Confirm refreshing alone has not created sessions.
4. Click **יצירת מפגשים מהמערכת השבועית**, then click again. Confirm two weekly
   sessions and zero new sessions on the second action. Refresh the browser.
5. Open today's session. Assign/change its instructor and save. Click
   **פתיחה / עדכון רשימת משתתפים** twice; confirm two participants without duplicates.
6. Mark one **נוכח/ת**, the other **נעדר/ת**. Add a note and correct a mark to
   **היעדרות מוצדקת**. Refresh and confirm status, editor/time and notes persist.
7. Expand **יומן שינויים במפגש ובנוכחות**. Confirm original/corrected status and
   editor/time remain visible. Search/filter **היסטוריית נוכחות** by participant.
8. Open the same session in two admin tabs. Change the same mark in the first,
   then in the stale second tab. Confirm a conflict message and reload, rather
   than an overwrite. Double-click a mark and confirm only one version is added.
9. In **חוגים**, change the weekly start/end time and save. Return and generate
   the same range. Confirm old sessions/marks remain intact; new times produce
   distinct sessions. Cancel an obsolete future session, confirm the dialog,
   regenerate, and verify it stays cancelled. Cancelled sessions cannot be marked.
10. Open a future session and confirm marking is disabled. Open a club with no
    rules or participants and confirm explicit empty states. Create a second
    synthetic club at the same time and verify rosters/history remain separate.
11. Change the date range, refresh, and check Israel dates/times (including a
    daylight-saving weekend). Try a range longer than 62 days: it must be rejected.
12. At 390px mobile width, open/close the sidebar, navigate to attendance, filter,
    open a session and mark/correct attendance without horizontal scrolling.
13. Sign out; sign in as instructor, cashier and operations users. Verify no
    attendance navigation item and no direct `/club-attendance` access. Verify
    authenticated RPC/table requests are denied by the database, not only the UI.
14. Compare staging membership/billing/financial records before and after these
    attendance operations. They must be unchanged. Review the release diff for
    no payment/accounting/provider changes. Approve production separately only
    after staging/migration and authenticated QA pass.

Until these release gates pass: **not approved for production deployment**.
