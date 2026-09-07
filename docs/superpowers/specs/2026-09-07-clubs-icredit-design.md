# Clubs and iCredit Recurring Billing Design

**Date:** 2026-09-07  
**Status:** Approved  
**Branch:** `workstream/clubs-icredit`  
**Base commit:** `c8a0663a35ae8254211194e3712519b79a1afe54`

## Goal

Add a real Clubs/Membership domain and a sandbox-only iCredit recurring-payment integration. Clubs remain independent of one-off activities and orders. The first UI is admin-only, hosted-card-entry only, and does not create Rivhit accounting documents.

## Approved v1 boundaries

- Monthly recurring billing only.
- Membership prices are snapshotted at registration.
- No proration.
- Immediate cancellation only.
- No pause/freeze UI, although lifecycle fields must permit a later additive implementation.
- iCredit performs automatic charging and retry policy; this system reconciles IPNs.
- Attendance tables are included; a full attendance-taking UI is deferred.
- No raw card flow, PAN, CVV, expiry, provider/card token persistence, sensitive IPN payload persistence, or unnecessary Israeli ID collection.
- No Production deployment, credentials, migrations, or live recurring agreement.

## Existing-system fit

The application is React/Vite with direct Supabase queries at the page/dialog boundary. Admin navigation is declared in `app/src/components/Layout.jsx`; routes are declared in `app/src/App.jsx`. Existing business tables use UUID primary keys, `created_by`, `created_at`, `updated_at`, the shared `update_updated_at()` trigger, and RLS helpers such as `is_admin()`.

The existing `activities` and `orders` tables describe one-off offerings and dated bookings. They are not extended for clubs. `instructors` is reused only as the staff identity assigned to a club.

## Data model

Migration `021_clubs_and_recurring_billing.sql` adds the following tables and no destructive changes.

### `clubs`

The recurring program definition: UUID, name, description, optional instructor, site, capacity, default monthly price, currency (`ILS` in v1), default billing day (1-28), status, notes, audit columns.

### `club_schedule_rules`

Reusable weekly schedule templates: UUID, club, weekday (0-6), start/end time, effective-from/effective-until, timezone, active flag and audit columns. Multiple rows per club support multiple weekly meetings. A constraint requires end time after start time.

### `club_sessions`

Sparse occurrences only. Rows are created when attendance is recorded or an occurrence needs an override/cancellation. They reference a club and optionally the source schedule rule, and store date/time/status. The system does not generate one order or session row for every future recurrence.

### `club_participants`

The participant/member identity plus neutral contact fields: participant name, optional birth date, phone/email, primary contact name/relationship/phone/email and notes. This supports both adult self-contact and child-with-parent contact without committing to a household/account model.

### `club_memberships`

Registration and lifecycle record: stable UUID, club, participant, registered/start/end dates, price snapshot, currency, billing day, membership status, payment status, debt amount, cancellation timestamps/effective date, notes and audit columns. A participant may have multiple historical memberships but only one non-terminal membership per club.

Membership lifecycle values are `pending_enrollment`, `active`, `paused`, `cancelled`, and `ended`. V1 exposes pending, active and cancelled only. Payment values are `not_enrolled`, `enrollment_pending`, `current`, `past_due`, and `cancelled`.

### `recurring_agreements`

The local/provider reconciliation record: stable local UUID, unique membership, provider (`icredit`), environment (`test`/`production`), status, unique iCredit `RecurringId`, creation `SaleId`, provider request reference, recurring cycle/step/day/count/start date, last charge number and audit timestamps.

No credit-card token or private sale token is retained. The random local agreement UUID is sent in iCredit `Custom1` to correlate the initial IPN without exposing a sequential identifier.

### `recurring_charges`

One stable local record per recurring obligation/charge number: agreement, provider `SaleId`, charge number, expected amount, currency, status, failure code/message, charged/failed/resolved timestamps and audit columns.

Uniqueness is enforced for provider `SaleId` and `(agreement_id, provider_charge_number)`. Therefore a retry for the same charge number updates the same row. A later charge number creates a separate obligation.

### `club_attendance`

Session + membership attendance status and notes. Unique per session/membership.

### `payment_webhook_events`

An idempotency ledger containing only a SHA-256 event digest, safe provider identifiers, processing state and timestamps. No raw IPN payload is stored. The digest is unique.

## Debt invariants

Debt is reconcilable from `recurring_charges` and never inferred from a generic order.

- A failed charge contributes its expected amount to debt.
- Duplicate IPNs do not create a second charge or second debt amount.
- A successful retry with the same agreement/charge number changes that charge to `succeeded`, records resolution, and removes only that charge from debt.
- A successful different charge number does not resolve older failures.
- After every processed charge event, membership debt is recomputed as the sum of failed charge rows. Payment status is `past_due` when that sum is positive and `current` otherwise, unless membership billing is cancelled.

The webhook ledger insert, agreement/charge upsert and membership debt recomputation execute in one database function so partial local state is not committed.

## iCredit provider flow

### Enrollment

1. Admin registers a participant and creates a membership.
2. An authenticated admin-only Edge Function creates or reuses one pending local agreement.
3. The function loads the membership, participant and club server-side and calls TEST `GetUrl` with:
   - the server-only `GroupPrivateToken`;
   - one item representing the snapshotted monthly membership price;
   - `CreateRecurringSale=true`;
   - `SaleType=2` (pending);
   - `RecurringSaleCycle=3`, `RecurringSaleStep=1`;
   - billing day 1-28, count 0, automatic charge enabled, proration disabled;
   - success/failure IPN URLs using POST;
   - the local agreement UUID in `Custom1`;
   - a stable request reference/unique number.
4. The function stores only safe response references and returns the hosted URL to the browser.
5. Card data is entered only on iCredit's hosted page.

Official sources: [GetUrl](https://rivhit-api.readme.io/reference/post_api-paymentpagerequest-svc-geturl), [recurring parameters](https://rivhit-api.readme.io/docs/recurring-methods-values), and [TEST environment](https://rivhit-api.readme.io/docs/test-enviornment-icredit).

### IPN verification and processing

Incoming form/JSON data is untrusted.

1. Parse only allow-listed fields and reject malformed IDs, amounts, charge numbers and unexpected payment-page identifiers.
2. Resolve the random local agreement from `Custom1`; obtain the expected price from the membership snapshot.
3. For an already-linked agreement, require the incoming `RecurringId` to equal the stored provider recurring ID.
4. Call iCredit TEST `Verify` with the configured server-side `GroupPrivateToken`, incoming `SaleId`, and the expected local amount. No success state is written unless the provider responds `Verified`.
5. Derive event kind from verified recurring fields: charge number 0 + pending J5 is agreement creation; charge number greater than 0 plus transaction status 0 is success; a nonzero/error transaction state is failure.
6. Compute a deterministic digest from the safe normalized fields and invoke one atomic database function. Duplicate digest, provider SaleId or agreement/charge number is a no-op/update, never another obligation.
7. Return HTTP 200 after a verified event is safely recorded. Invalid/unverified messages receive an error and no billing-state mutation.

iCredit documents a 1.25-second IPN timeout and automatic retries, making database idempotency mandatory. It documents `Verify` rather than an HMAC signature. Sources: [IPN flow](https://rivhit-api.readme.io/docs/ipn-webhook), [Verify](https://rivhit-api.readme.io/reference/post_api-paymentpagerequest-svc-verify), and [recurring IPN fields](https://rivhit-api.readme.io/docs/ipn-messages).

All logged diagnostic objects are sanitized. Card/token fields and raw request bodies are neither logged nor stored.

### Cancellation

An authenticated admin-only Edge Function loads the local active agreement and calls TEST `RecurringSaleCancel` with the stored `RecurringSaleId`. Only a successful provider response (`Status=0`) invokes the atomic local cancellation function. A provider failure leaves membership/agreement active and returns an explicit error to the UI.

Source: [RecurringSaleCancel](https://rivhit-api.readme.io/reference/post_api-paymentpagerequest-svc-recurringsalecancel).

## Accounting-document isolation

This workstream does not call any Rivhit document, receipt or accounting endpoint and does not send `DocumentType`/`ReceiptType` as a presumed disable switch. iCredit's documentation says those request values select what to produce and otherwise defer to payment-page settings. Therefore a dedicated recurring payment page must be inspected/configured in iCredit with automatic document and receipt generation disabled before activating enrollment.

The shared public TEST token may not prove the configuration of the client's future dedicated recurring page. The implementation must report dashboard inspection results and refuse to claim document generation is disabled if that setting cannot be verified.

## Authorization and RLS

- All Clubs UI routes are admin-only.
- Club domain tables are admin read/write in v1.
- Provider agreements, charges and webhook events allow admin read-only access through safe columns; browser clients have no insert/update/delete policies.
- Edge Functions use the service role only after authenticating and authorizing admin requests. The public IPN endpoint is JWT-exempt but can mutate billing state only after iCredit Verify succeeds.
- Internal database mutation functions revoke execution from `anon` and `authenticated` and grant it only to `service_role`.

## UI

`/clubs` is a Hebrew RTL master/detail workspace consistent with the existing app:

- Header and summary counts for active clubs, active members and memberships with debt.
- Searchable club list with instructor, schedule, monthly price, capacity and status.
- Create/edit club dialog, including multiple weekly schedule rules.
- Selected-club detail with participant/contact, membership status, payment/debt state and billing action.
- Registration dialog creates a participant and membership with a price snapshot.
- Hosted enrollment opens the URL returned by the server function.
- Immediate cancellation requires confirmation and surfaces provider failures without changing local state.

## Testing strategy

- Migration contract tests cover additive tables, constraints, indexes, server-write RLS and restricted functions.
- Provider-adapter tests cover TEST endpoint selection, GetUrl payload, secret exclusion, safe logging and cancellation.
- IPN tests cover verified creation, invalid/unverified messages, duplicate delivery, success, failure, debt, same-charge retry and unrelated-month success.
- UI tests cover create/edit club, multiple schedule rules, participant registration, membership price snapshot, enrollment launch, cancellation success/failure and membership status.
- Existing tests, build and lint delta are checked before completion.

## Deferred client decisions

The schema keeps these additive/configurable, but the behavior remains deliberately absent until Nurit decides:

- Child versus parent/contact/household ownership model.
- Future-dated cancellation rules and access until effective date.
- Proration formula and first-charge timing.
- Freeze/pause eligibility, duration, pricing and make-up sessions.
- Debt reminders, retry escalation, grace periods, collections and attendance blocking.

## Production gate requirements

Before Production, obtain/confirm:

- iCredit recurring-sales service/module activation.
- A dedicated recurring terminal.
- SHVA recurring-sale permission `1` and J5 permission `1`.
- A dedicated recurring payment page created by iCredit support.
- That page's Production `GroupPrivateToken` and page defaults.
- Automatic document/receipt generation disabled on that page.
- Production HTTPS success/failure IPN URLs and POST mode.
- Verify, recurring-details/history/update/cancel method availability for the merchant.
- Duplicate-payment prevention enabled in payment-page settings.
- Whether 3DS is required; if so, SHVA internet provider `3`, provider approval and iCredit 3DS activation.
- Production redirect URLs, allowed origins and operational ownership for failed-payment handling.

None of these Production actions are performed by this branch.
