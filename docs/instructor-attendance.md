# Instructor attendance: combined staging candidate

Continues `workstream/clubs-attendance` from pushed admin checkpoint `2e7903d`.
The verified admin page, session generation, eligibility rules, attendance audit,
versioning, cancellation and history remain in place. No staging/production
deployment, remote migration, user creation or financial/provider operation was
performed during this phase.

## Authentication audit

* Supabase Auth uses the existing email/password login. `profiles.id` is a PK/FK
  to `auth.users.id`, with full name/email and `user_role`.
* Roles already include admin, operations, cashier and instructor. AuthContext
  maps instructor to `מדריך`; Layout gates navigation and route access.
* Instructors already have authenticated schedule access. Existing task and
  maintenance assignments reference profile IDs. No live login/activity records
  were queried, so actual instructor usage was not measured.
* `instructors` contains business-record UUID, full name, phone, optional email,
  specialties, notes and active status. `created_by` is the creator, not the
  instructor's login identity. No user/profile ownership FK existed.
* Important legacy finding: migration 002's `get_my_instructor_id()` matches
  profile email to instructor email with `LIMIT 1`; migration 003 uses it in
  Orders/quotes policies. That helper is NOT used or changed by attendance.
  This phase does not claim to audit/fix every legacy instructor permission.
* Users UI and authenticated admin-only `create-user` Edge Function already
  provision users/manage roles. Their previous allowlists excluded instructor.
  The same allowlists now include the existing instructor enum; no new login
  mechanism or admin bypass was introduced. Existing role-escalation protection
  from migration 024 remains unchanged.

## Explicit identity and administration

Migration `202610050002_instructor_attendance.sql` creates:

* `instructor_user_links`: instructor UUID PK, nullable profile UUID UNIQUE,
  version, actual admin actor and update timestamp. One user can link to only
  one instructor; one instructor can link to only one user.
* `instructor_user_link_audit`: immutable application-level audit of old/new
  profile UUIDs, instructor UUID, version, actor and timestamp. No contact or
  credential values are copied into the link or audit tables.

No automatic backfill or name/email/phone matching occurs. Users page adds a
small **קישור מדריכים למשתמשים** section. Admin selects an existing instructor
and an instructor-role profile, distinguished by name/email/UUID, then explicitly
clicks **שמירת קישור**. The UI never selects a match automatically.

`set_instructor_user_link` checks admin, validates target role/IDs, locks the
instructor and current link, and uses expected version plus a unique constraint.
Concurrent/stale/duplicate links fail atomically. Linking and its audit are one
transaction. Unlinking is an explicit versioned save with `profile_id=NULL`.
Raw link/audit DML is revoked; admin-only RLS protects reads. No attendance rows
are rewritten on link/unlink.

Changing contact details has no access effect. Changing the profile away from
instructor immediately disables instructor attendance rights on subsequent DB
requests. The link remains recorded; an admin changing the profile back restores
its linked rights. Unlink if revocation should persist across later role changes.
Linked users must be unlinked before deletion; foreign keys enforce this. Prior
attendance/link audit UUIDs survive user deletion. Instructor business records
with a link-history row are retained (archive/inactivate instead of deleting).

## Permissions and response boundaries

| Capability | Admin | Explicitly linked instructor | Other roles |
| --- | --- | --- | --- |
| Manage identity links | Yes | No | No |
| Generate club sessions | Yes | No | No |
| Assign/cancel/complete sessions | Yes | No | No |
| Prepare roster | Any session | Own assigned, non-cancelled session | No |
| Read attendance | Existing admin history | Own assigned sessions via projection RPCs | No |
| Mark/correct | Any eligible session | Own assigned eligible session | No |
| Raw Clubs/membership/attendance tables | Existing admin RLS | No new access | Unchanged |

`get_instructor_club_sessions(from,until)` checks the current profile role and
explicit link, accepts at most 62 calendar days and returns only:
`id`, `club_name`, `session_date`, `start_time`, `end_time`, `status`.
An unlinked instructor gets an empty list with `linked:false`.

`get_instructor_club_roster(session)` checks assignment server-side and returns
only `membership_id`, `participant_name`, `status`, `notes`, `version`, `updated_at`.
Changing a session ID cannot bypass it. No email, phone, birth date, participant
contact/billing fields, membership billing state, session admin notes or other
instructor's data is returned. Raw-table policies were not widened.

The existing `prepare_club_roster` and `mark_club_attendance` implementations
remain functionally identical except for their authorization guard. Writes lock
the session before checking its frozen instructor assignment, and lock the
profile/link while authorizing. Concurrent reassignment, unlink or role changes
therefore serialize with attendance writes. The original version check still
rejects stale/double edits. The server records the actual authenticated instructor
as actor. Cancelled sessions remain read-only; future attendance remains blocked.

RPCs are SECURITY DEFINER with fixed search paths and explicit checks. Internal
helpers and public/anon/service-role execution privileges are revoked; only the
intended authenticated entrypoints are granted. They do not call any external
provider or financial/accounting routine. Read RPCs are STABLE and do not prepare
rosters or write on refresh.

## Assignment behavior

Generated sessions already freeze `instructor_id`/name from the club. Changing
the club instructor affects new sessions only. Existing/historical session
ownership and attendance do not change. An admin can explicitly reassign one
session using the existing session editor; this is audited and transfers access
to the new linked instructor while retaining the original marks/editor history.
Cancelled sessions cannot be reassigned through the existing editor.

## Instructor UI

Separate `/instructor-attendance` route and **נוכחות בחוגים** navigation item,
visible only to the instructor role. It does not mount the admin Clubs page.
Default range: seven days back through fourteen days ahead. The instructor opens
an assigned session, explicitly prepares/updates its roster when needed, then
taps **נוכח / נעדר / מוצדק**, optionally adding a note before saving/correcting.

The Hebrew/RTL screen uses mobile cards and touch-sized status buttons. Loading,
unlinked, empty, denied, cancelled, future and stale-update states are explicit.
Uncertain writes trigger a fresh ownership/list/roster read before retry. Account
switches remount the workspace; rejected access clears displayed session details.
No credentials or attendance values are logged.

## Verification

* Existing checkpoint: 633 passing application/Edge tests; 55 DB assertions.
* Combined candidate: **653 tests / 65 files pass**, including admin attendance,
  Clubs, Orders, Pelecard/payment and accounting regression suites. New tests
  exercise actual `create-user` handler logic using synthetic clients; no auth
  account is created in a real environment.
* Disposable PostgreSQL: **55 admin + 57 instructor assertions pass**. Includes
  explicit/invalid/stale/duplicate/concurrent links, contact/name changes, matching
  identity denial, own/foreign session IDs, roster projections, read/write/admin
  restrictions, cancellation/future rules, concurrent marks, frozen assignment,
  explicit reassignment, unlinking, role revocation, user deletion audit retention,
  and unchanged financial/membership fingerprints around attendance operations.
* Build passes with synthetic loopback Supabase settings.
* Typecheck still reports **175 PRE-EXISTING errors**. Diagnostics are identical
  after normalizing shifted line/column locations. **No introduced errors.**
* Playwright synthetic fixtures: desktop 1440px and mobile 390px, preparation,
  marking/correction, navigation, mobile admin linking, no horizontal overflow or
  runtime errors. External network requests blocked. Screenshots inspected.
* Both attendance migrations rehearsed together only on disposable loopback
  PostgreSQL 18 using actual 023/028 prerequisites and minimal auth fixtures.
  This is not yet a full deployed-schema/PostgREST/authenticated staging rehearsal.
* Existing Browserslist age and React dialog accessibility warnings remain.

Run `node scripts/clubs/attendance.test.mjs` with the runtime setup in
[the admin documentation](clubs-attendance.md#reproduce-automated-checks-powershell).
It now runs both DB suites. Application commands remain `npm test`,
`npm run typecheck`, `npm run build`; use synthetic local Vite settings for tests.

## Next authorized phase: staging rehearsal, not production

The combined implementation is ready for staging rehearsal; there is no remaining
identity/product blocker. No staging/production deployment or migration was
performed. No branch merge was performed. Before a later staging action:

1. Verify the isolated staging project's identity and disable all financial/provider
   workers and credentials. Use synthetic users/data only.
2. Reconcile prerequisite migrations with its existing schema; rehearse
   `202610050001_clubs_attendance.sql`, then `202610050002_instructor_attendance.sql`.
   Do not blindly apply unrelated migrations from other worktrees to production.
3. Stage this combined frontend and the existing `create-user` function update
   with its authenticated/admin checks intact. Create no automatic user links.
4. Run authenticated/PostgREST QA below before approving a production release.
   Reconcile the candidate with the separately verified production baseline before
   any production deployment. The main-based branch is not a wholesale replacement
   for unrelated production work.

## Essential personal QA after staging

1. As admin, open **ניהול משתמשים**. Create two synthetic instructor-role users
   (or use existing test users). In **קישור מדריכים למשתמשים**, link each to a
   different instructor record and save. Attempt a duplicate link: it must fail.
2. Open admin **נוכחות חוגים**. Create test sessions for both instructors and
   eligible synthetic participants. Include today, a future session and a
   cancelled session. Verify normal admin attendance still works.
3. Sign in as instructor A. Open **נוכחות בחוגים**. Confirm only A's sessions and
   club names appear, with no admin Clubs or financial controls.
4. Open today's session → **פתיחה / עדכון רשימת משתתפים** → mark **נוכח** → add
   a note → change to **מוצדק**. Refresh; confirm persistence. Repeat on a phone.
5. In a second A tab, load the same mark before changing it in the first tab.
   Save the stale second version: it must show a conflict and reload.
6. As admin, change the club instructor: existing sessions must stay assigned to
   A. Explicitly reassign one session to B. Refresh as A: it disappears; as B:
   its original attendance remains and can be corrected. Confirm audit as admin.
7. Unlink A (or change A to a non-instructor role). Refresh A: access is gone.
   Confirm future/cancelled sessions reject marking; cashier/operations accounts
   cannot open the instructor or admin attendance routes. Technical staging QA
   must also test foreign-session RPC IDs directly, not only hidden navigation.

Payments, accounting, provider operations and iCredit remain out of scope.
