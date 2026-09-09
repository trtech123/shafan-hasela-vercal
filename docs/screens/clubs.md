# Clubs Screen Action Map

## Confirmed business-rule extension (2026-09-09)

- Registration separates `הורה / משלם` contact and billing identity from `משתתף / ילד` details.
- New recurring agreements use fixed billing day 15 and begin in the month after participation starts; joining-month lessons are paid manually at the cashier and are never prorated automatically.
- Cancellation confirmation displays the calculated membership end date and effective cancellation month using the day-10 rule.
- Scheduled cancellations remain financially active until the due worker receives provider confirmation; local success is never asserted before iCredit.
- Failed recurring charges remain debt, create one durable notification intent, and are visible to staff.
- Participant management displays a billing-derived green `✓ מוסדר` or red `✕ לא מוסדר` indicator.
- Freeze remains display-only/pending; no freeze action or provider workflow is added.

**Route:** `/clubs`  
**Access:** admin only

## Visible actions

- `חוג חדש`: open empty club editor.
- Club card/row: select club and show its detail.
- Edit: open club editor prefilled with core fields and all weekly schedule rules.
- Search/filter: filter clubs by name, instructor and status.
- `רישום משתתף`: open participant/membership registration.
- `התחלת הוראת קבע`: invoke the authenticated enrollment Edge Function and open the returned iCredit TEST hosted URL.
- `ביטול חברות`: show the deterministic effective period, schedule the request, and finalize local cancellation only after the due provider-first iCredit operation succeeds.
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
13. No Rivhit accounting-document endpoint is called, and local Clubs state is never treated as a second financial system of record.
