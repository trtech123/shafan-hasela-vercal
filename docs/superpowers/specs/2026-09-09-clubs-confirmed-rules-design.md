# Clubs Confirmed Business Rules Design

**Date:** 2026-09-09  
**Base:** release candidate `0a36f0a5f6331088570012facd7860a9807a66e8`

## Outcome

Clubs clearly separates payer/parent from participant/child, schedules all new recurring billing on day 15 for the current month, starts recurring billing in the month after joining without proration, schedules cancellation according to the day-10 rule, preserves failed debts and notification intent, and exposes billing-derived payment state in participant management.

## Compatibility strategy

Migration `028_clubs_confirmed_business_rules.sql` is expand-only. Existing `primary_contact_*` values remain intact and become the payer/contact fields in the UI. Additive billing identity and recurring-start fields avoid reinterpreting historical data. Existing active provider agreements are not silently rewritten because changing only local day values would diverge from iCredit; all new/pending enrollment paths are forced to day 15, while legacy active deviations remain visible for reconciliation.

## Payer and participant

`club_participants.first_name/last_name/birth_date` continue to describe the participant. Existing `primary_contact_*` columns describe the payer/parent contact and are relabeled accordingly. Add `billing_identity_name` and `billing_identity_number` for invoice identity. New registrations require payer name and phone, but old records may fall back to participant contact so legacy rows remain usable. iCredit enrollment uses payer name/contact, never the child's name as the payer when payer data exists.

## Joining and recurring billing

`club_memberships.starts_on` remains the participation/join date. A new `recurring_starts_on` stores the first day of the following month. The provider agreement copies `recurring_starts_on`, uses day 15, and retains the existing `RecurringSaleProRata: false` contract. The UI explains that relevant lessons in the joining month are paid manually at the cashier and no automatic proration occurs.

## Cancellation

For a Jerusalem calendar request date on or before day 10, `cancellation_effective_on` is the first day of the next month and `ends_on` is the last day of the current month. After day 10, effectiveness is the first day two months later and membership ends on the last day of the next month. December/year boundaries use calendar arithmetic.

The request is persisted as a scheduled cancellation and displayed before confirmation. iCredit is not cancelled immediately, because doing so before the remaining required day-15 charge could undercharge. A due-cancellation worker claims scheduled jobs at the effective date, calls iCredit first, and only then finalizes local membership/agreement state. Provider failure leaves membership financial state intact and records retry/reconciliation state.

## Failed recurring charge notification

The verified IPN transaction keeps the failed charge and debt, and inserts exactly one notification intent per failed charge/purpose. The row stores payer destination, participant name, generated Hebrew message, status, attempts, and error. Real background delivery is disabled as `configuration_required` until an approved Meta Utility template/provider configuration exists; no unsolicited free-text message is sent. A later successful IPN resolves the charge/debt but does not duplicate notification intent.

## Participant payment indicator

The participant-management list receives a dedicated payment column derived from real membership/charge state. `payment_status === current` with zero debt renders a green `✓ מוסדר`; all not-enrolled, pending, past-due, failed, or positive-debt cases render a red `✕ לא מוסדר`. The indicator is not editable.

## Freeze

No new freeze endpoint, button, or iCredit call is introduced. The existing legacy `paused` display value remains passive. Tests assert that no freeze action is exposed.

## Non-goals

- No automatic proration.
- No iCredit-to-Rivhit accounting document creation.
- No mutation of active legacy provider schedules without a confirmed provider update contract.
- No real recurring charge, cancellation, customer notification, or Production migration application during implementation.

