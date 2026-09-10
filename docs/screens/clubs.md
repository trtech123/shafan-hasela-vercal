# Clubs Screen Action Map

**Route:** `/clubs`  
**Access:** admin only

## Visible actions

- `חוג חדש`: open empty club editor.
- Club card/row: select club and show its detail.
- Edit: open club editor prefilled with core fields and all weekly schedule rules.
- Search/filter: filter clubs by name, instructor and status.
- `רישום משתתף`: open participant/membership registration.
- `התחלת הוראת קבע`: invoke the authenticated enrollment Edge Function and open the returned iCredit TEST hosted URL.
- `ביטול חברות`: confirm, cancel the iCredit recurring agreement, then cancel local membership only after provider success.
- Retry enrollment: reuse the stable pending agreement rather than create duplicates.

## Club form

- Name (required)
- Description
- Instructor
- Site
- Capacity
- Default monthly price (required)
- Default billing day, 1-28 (required)
- Status
- Notes
- One or more weekly schedule rules: weekday, start time, end time, effective dates

## Registration form

- Participant first/last name (required)
- Optional birth date, phone and email
- Primary contact name, relationship, phone and email
- Membership start date
- Membership monthly price, prefilled from club but saved as an independent snapshot
- Billing day, prefilled from club
- Notes

## Data loaded

- `clubs` with instructor
- `club_schedule_rules` for listed clubs
- `club_memberships` for the selected club
- `club_participants` referenced by selected memberships
- safe billing summaries from `recurring_agreements` and `recurring_charges`

No `orders` or one-off recurring session rows are loaded or generated.

## Data written

- Create/update `clubs`.
- Replace the edited club's schedule-rule set after validating every row.
- Create `club_participants` and `club_memberships` during registration.
- Billing state is never directly written by browser code. Enrollment, IPN and cancellation use Edge Functions plus service-role-only database functions.

## Cross-screen effects

- Instructor assignment references the existing `instructors` table.
- No existing Activities, Orders, Quotes, Schedule or accounting-document behavior changes.
- Future Schedule/attendance integrations can expand recurrence rules without backfilling recurring orders.

## Acceptance criteria

1. Only admins see and can open `/clubs`; other roles are redirected.
2. Admin can create and edit a club with multiple weekly schedule rules.
3. Club list shows instructor, schedule, monthly price, capacity and status.
4. Admin can register a participant and create a membership whose price remains unchanged after the club default changes.
5. Participant detail shows membership, payment and debt states.
6. Enrollment invokes the server function and opens only an iCredit TEST hosted payment URL.
7. Duplicate enrollment attempts reuse the same pending/active local agreement.
8. Verified creation IPN activates the agreement; unverified IPNs change nothing.
9. Duplicate charge IPNs do not duplicate charges or debt.
10. A failed charge creates debt; a success for the same charge resolves it; another month's success does not.
11. Provider cancellation failure leaves local state active; provider success cancels agreement and membership.
12. Browser code never receives merchant credentials, raw card data or provider/card tokens.
13. No Rivhit accounting-document endpoint is called.
# Clubs operational rules (2026-09-10)

## Action map

- `חוג חדש` / `עריכת חוג`: club, instructor, site, monthly price, weekly schedule. Billing is read-only: day 15 for the current month.
- `רישום משתתף`: separate `משתתף / ילד` and required `הורה / משלם` contact sections. Joining month is flagged for manual cashier settlement; iCredit recurring starts on the first of the next month without automatic proration.
- Membership cards load Clubs, schedule, participant, payer/contact, membership, iCredit agreement/debt, recurring start, and cancellation dates.
- `ביטול`: previews the deterministic effective month, then stores a scheduled request. On/after the effective date, `השלמת ביטול ב־iCredit` calls the existing provider-first cancellation boundary.
- Attendance reads `club_attendance_operations`; its ✓ / ✕ / unknown payment badge is derived from the authoritative iCredit charge for the session month and is not editable.
- Failed-payment follow-up reads `club_payment_follow_ups`; one pending, unsent operational item is created per failed provider charge. This workstream does not deliver messages.
- If migration 028 is unavailable in Preview, `פתיחת תצוגת הדגמה ללא מסד נתונים` renders a visibly synthetic inspection state and performs no writes.

## Acceptance criteria

- Parent and child remain distinct and legacy primary-contact values are backfilled into payer fields.
- Billing day cannot differ from 15; charge month is explicit and provider-authoritative.
- Day 10 / day 11 / year-boundary cancellation calculations are deterministic.
- Failed, successful, and unknown states render as ✕, ✓, and neutral respectively.
- Duplicate provider events cannot create duplicate charges or follow-ups.
- No Clubs accounting-document route, automatic proration, new freeze workflow, or real customer message exists.
