# Clubs recurring billing: iCredit TEST operations

**Checked:** 2026-09-07  
**Scope:** TEST only. No Production deployment, migration, credential, card submission, recurring agreement, or accounting API was used.

## Implemented flow

`club-recurring-enroll` creates or reuses a stable local agreement and requests an iCredit-hosted TEST URL. The browser receives only that hosted URL and the local agreement ID. iCredit sends creation and monthly-charge IPNs to `club-recurring-ipn`; the function allow-lists and validates fields, loads the local price snapshot, calls the official TEST `Verify` endpoint, then invokes one idempotent database function. `club-recurring-cancel` calls TEST `RecurringSaleCancel` first and finalizes the local cancellation only after provider status `0`.

The adapter is deliberately fixed to `https://testicredit.rivhit.co.il`. It has no Production URL switch. It neither accepts nor persists PAN, CVV, expiry, a card token, `TransactionToken`, `PrivateSaleToken`, a raw IPN body, or an Israeli ID number. It does not call a Rivhit accounting endpoint.

Official references:

- [GetUrl](https://rivhit-api.readme.io/reference/post_api-paymentpagerequest-svc-geturl)
- [Recurring parameter values](https://rivhit-api.readme.io/docs/recurring-methods-values)
- [IPN delivery](https://rivhit-api.readme.io/docs/ipn-webhook)
- [Recurring IPN fields](https://rivhit-api.readme.io/docs/ipn-messages)
- [Verify](https://rivhit-api.readme.io/reference/post_api-paymentpagerequest-svc-verify)
- [RecurringSaleCancel](https://rivhit-api.readme.io/reference/post_api-paymentpagerequest-svc-recurringsalecancel)

## Required server configuration

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Add these secrets only to the server-side Edge Function environment:

| Variable | TEST value/source | Rule |
| --- | --- | --- |
| `ICREDIT_GROUP_PRIVATE_TOKEN` | Identifier of the dedicated TEST recurring page | Never expose in browser code or logs. Do not use the shared public documentation token for acceptance. |
| `ICREDIT_REDIRECT_URL` | HTTPS application completion page | Must be at least 15 characters and HTTPS. |
| `ICREDIT_IPN_URL` | Public HTTPS URL for `club-recurring-ipn` | Must accept POST from the internet on port 443. |
| `ICREDIT_FAILURE_IPN_URL` | Usually the same public function URL | Optional; defaults to `ICREDIT_IPN_URL`. |

Enrollment and cancellation keep JWT verification enabled and perform a second admin-role check. The IPN endpoint must be deployed with gateway JWT verification disabled because iCredit is not a Supabase user. Its application boundary still accepts only POST and cannot mutate billing state before server-to-server Verify succeeds. If deployment is later approved, deploy that function with the Supabase equivalent of `--no-verify-jwt`; do not disable JWT on the admin functions.

iCredit documents a 1.25-second IPN response timeout and retries. The handler therefore uses both a unique digest ledger and stable provider identities. Operationally, monitor non-2xx IPN responses and reconcile them from iCredit recurring reports; do not manually insert charge rows.

## TEST inspection results

The official TEST management login and published test identifier were taken from the [iCredit TEST environment page](https://rivhit-api.readme.io/docs/test-enviornment-icredit). The shared dashboard was inspected read-only on 2026-09-07.

### Hosted GetUrl contract smoke

A non-personal, ₪1 request using the official published TEST identifier returned HTTP `200`, provider `Status=0`, and an HTTPS hosted URL on `testicredit.rivhit.co.il/payment/PaymentItems.aspx`. The hosted page displayed the test item and iCredit card-entry section. No card fields were filled, the page was not submitted, and no recurring agreement or charge was activated.

### Payment-page settings and accounting isolation

The TEST account listed 15 shared pages. Its visibly recurring example page, `ת"י הו"ק`, had:

- recurring creation enabled;
- monthly cycle, step 1, unlimited charge count, and Pro Rata off;
- automatic charge off in the page default (the API request explicitly sets it on);
- **`ללא סנכרון ריווחית` unchecked**;
- Rivhit document defaults showing document type `2` and receipt type `0`.

The page list described that page's terminal as an internet-and-invoices terminal. This means automatic accounting isolation is **not verified and must not be assumed** for the shared recurring page. The official published API test identifier could not be mapped to one of the 15 edit screens: it does not appear in the list/edit markup available to this shared user. Consequently, its exact document default is also unverified.

`DocumentType`, `ReceiptType`, and `SendMail=false` are not document-disable controls. Official GetUrl documentation describes the type fields as selecting the automatic document/receipt and says omitted values fall back to page settings. `SendMail` controls delivery, not creation.

Before any full TEST enrollment (and later before Production), iCredit support/client administration must create or designate a **dedicated Clubs recurring payment page** and, on that exact page:

1. Enable recurring sales and bind it to the designated recurring terminal.
2. In `הגדרות ריווחית`, check **`ללא סנכרון ריווחית`** (no Rivhit synchronization).
3. Confirm no automatic document and no automatic receipt will be produced for both initial enrollment and automatic recurring charges.
4. Enable automatic charge, monthly cycle, step 1, unlimited count, and Pro Rata off, or confirm the API overrides are honored.
5. Configure POST IPN success/failure URLs and duplicate-payment prevention.
6. Copy the identifier from `הגדרות הדף` for that exact page and install it as the server secret.
7. Run a witnessed TEST charge and verify both the iCredit transaction/recurring reports and the absence of any Rivhit document/receipt before enabling real enrollment.

Until steps 1-7 are completed, the code is integration-ready but the no-accounting-document requirement is an external configuration blocker. No code path in this branch creates documents.

## Production enablement checklist

iCredit's [Recurring Sales guide](https://rivhit-api.readme.io/docs/recurring-sales) requires:

- activation of the iCredit recurring-sales service/module;
- a terminal designated only for recurring sales;
- SHVA recurring-sale permission `1`;
- SHVA J5 permission `1`;
- iCredit support to create the designated recurring payment page after terminal permissions are active.

Obtain and verify all of the following before a Production-capable adapter is designed or enabled:

- Production merchant/account identity and a Production recurring terminal identifier.
- The dedicated Production page's `GroupPrivateToken`; the official guide shows it under Payment Pages → list → edit → `הגדרות הדף` ([identifier instructions](https://rivhit-api.readme.io/docs/get-groupprivatetoken-from-icredit)).
- Written confirmation/screenshot that `ללא סנכרון ריווחית` is enabled and automatic document/receipt generation is disabled on that exact page.
- Production HTTPS redirect URL, POST IPN success URL, and failure IPN URL.
- Provider confirmation that `GetUrl`, `Verify`, `RecurringSaleDetails/List/History`, `RecurringSaleCancel`, and required update methods are enabled for the merchant. The recurring guide lists charge-condition, item/amount, customer, and card-update APIs; v1 implements cancellation only.
- Webhook authentication expectations. The official IPN documentation supplies source IPs and the Verify flow but documents no IPN HMAC signature. Confirm with iCredit whether the merchant has an additional signature feature; retain Verify in every case.
- Firewall allowance, if an allow-list is used, for the iCredit IPs documented on the IPN page; HTTPS port 443; and alert ownership for delivery/reconciliation failures.
- Duplicate-payment prevention enabled and its configured time window.
- Whether 3DS is required. If it is, the [3DS guide](https://rivhit-api.readme.io/docs/3ds-process) requires SHVA `Internet provider = 3`, acquiring-provider approval, and iCredit service activation. Hosted pages already handle the challenge; the later Production design may set `Use3DS` after confirmation.
- Cancellation/update permissions and the operational process for a provider-success/local-failure reconciliation case.

The Production base URL, credentials, and feature flag do not exist in this branch by design.

## Open business decisions for Nurit

These do not block the additive schema or TEST adapter, but must be answered before broader rollout:

- Whether a participant is always the child, when the payer/contact is a parent, and whether one household/contact can own multiple children.
- Whether future versions allow end-of-period or future-dated cancellation instead of v1 immediate cancellation.
- Whether and how first/last partial months are prorated; v1 never prorates.
- Freeze/pause eligibility, maximum duration, payment behavior, attendance access, and restart rules; v1 has no pause UI.
- Dunning policy after iCredit retries: grace period, reminder channels, escalation, write-off/refund rules, attendance blocking, and who resolves exceptions.
- Whether capacity is a hard registration limit or an informational warning.
- Whether staff need an attendance screen and who may edit historical attendance.

## Verification/reconciliation notes

- Creation IPN is recognized by recurring charge number `0` and J5 marker `5`; monthly charges use a positive charge number.
- The local agreement UUID in `Custom1` is the correlation key. Stored `RecurringId`, creation/charge `SaleId`, agreement/charge number, and event digest are unique where applicable.
- Verify is called with the locally expected snapshotted amount. Group/page identifier, local agreement, existing provider recurring ID, amount, and TEST environment must all match.
- A duplicate digest is a no-op. A provider retry with the same charge number updates the same obligation. Success for another charge number never clears an older failure.
- Cancellation is provider-first. Provider failure restores the agreement to active and leaves membership active; a provider success followed by local RPC failure remains visibly `cancellation_pending` for reconciliation.
