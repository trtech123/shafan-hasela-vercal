# Pelecard → Rivhit activation handoff

The implementation is fail-closed until the following provider/accounting inputs are supplied. These are configuration/contract inputs; no code redesign is required.

## 1. Pelecard terminal contract

Request the written Redirect/IFrame 2.0 contract for the exact Shafan Hasela terminal, including:

- hosted-payment initiation endpoint, HTTP method/content type, authentication fields, required request fields, amount unit, currency representation, and response fields for redirect URL and session reference;
- the exact field used to carry our immutable local payment UUID as Pelecard `UniqueKey`;
- callback and browser-return field names/encoding for `ConfirmationKey`, `UniqueKey`, provider transaction ID, and any callback correlation reference;
- the server-to-server `ValidateByUniqueKey` endpoint, method, authentication fields, request schema, and authoritative response schema;
- authoritative response fields for transaction ID, approval ID, status code, amount, currency, and terminal number;
- the terminal's documented success status codes and sandbox redirect origins/credentials.

Public Pelecard marketing/API pages do not publish this terminal-specific wire contract. Do not infer field names or endpoints from third-party samples.

Once received, wire the already-injected capabilities in `pelecard-initiate`, `pelecard-callback`, and `pelecard-verify`; the reconciliation, correlation checks, atomic finalization, outbox, and Rivhit path are already implemented.

## 2. Rivhit `payment_success` mapping

Obtain accountant/client approval for this exact semantic entry in `RIVHIT_DOCUMENT_TYPE_MAP`:

```json
{
  "payment_success": {
    "document_type": "<approved numeric Rivhit document type>",
    "sort_code": "<approved numeric sort code>",
    "currency_id": "<approved numeric ILS currency id>",
    "currency_code": "ILS",
    "price_include_vat": "<approved boolean>",
    "send_mail": "<approved boolean>",
    "digital_signature": "<approved boolean>"
  }
}
```

The quoted placeholders above are documentation only and are intentionally invalid configuration. Never substitute guessed numbers. Missing/invalid mapping moves the outbox event to `configuration_required` before any Rivhit request and leaves payment success intact.

## Safe release sequence

1. Apply migrations 021–027 in order to a disposable/staging database and run the SQL behavior tests.
2. Deploy the Pelecard initiation/callback/verify/status functions and the protected accounting worker to staging.
3. Configure sandbox Pelecard contract values and a Rivhit sandbox `payment_success` mapping/account namespace.
4. Perform one disposable sandbox payment and verify exactly one sale, one accounting event, and one Rivhit sandbox document; replay callback and worker requests to prove no duplicate.
5. Only after accountant approval, configure Production mapping and deploy. A real Production charge or Rivhit document remains a separately authorized action.

iCredit recurring charges are explicitly excluded from this application accounting path; Clubs financial authority remains iCredit.
