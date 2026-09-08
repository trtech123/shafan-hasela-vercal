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
