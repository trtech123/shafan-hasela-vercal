# Rivhit accounting function

The standalone function creates Rivhit accounting state for an existing Shafan order. The separate `payment-accounting-worker` processes durable accounting events created only after a locally verified Pelecard payment succeeds. iCredit recurring charges remain excluded to avoid duplicate documents.

## Server secrets

- `RIVHIT_API_TOKEN`: Rivhit Online/Invoice Online account API token.
- `RIVHIT_ACCOUNTING_MODE`: exactly `sandbox` or `production`.
- `RIVHIT_ACCOUNT_NAMESPACE`: stable, non-secret identifier for the Rivhit account and environment. Sandbox and Production must use different values.
- `RIVHIT_DOCUMENT_TYPE_MAP`: reviewed JSON mappings keyed by business purpose.
- Standard Supabase function variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

Example shape only (the numeric document type and behavior are not a Production recommendation):

```json
{
  "sandbox_test": {
    "document_type": 1,
    "sort_code": 100,
    "currency_id": 1,
    "price_include_vat": true,
    "send_mail": false,
    "digital_signature": false
  }
}
```

Pelecard activation additionally requires a reviewed `payment_success` mapping whose `currency_code` exactly matches the durable payment currency:

```json
{
  "payment_success": {
    "document_type": 0,
    "sort_code": 0,
    "currency_id": 0,
    "currency_code": "ILS",
    "price_include_vat": true,
    "send_mail": false,
    "digital_signature": false
  }
}
```

The zeros are placeholders only. Do not activate this mapping until the accountant/client supplies and approves the numeric Rivhit values.

The function accepts an authenticated `admin` or `operations` request:

```json
{
  "sourceType": "order",
  "sourceId": "<order UUID>",
  "documentTypeKey": "<configured mapping key>"
}
```

The protected payment worker also accepts only `admin` or `operations`, with an exact request body:

```json
{
  "eventId": "<accounting event UUID>",
  "forceRetry": false
}
```

`forceRetry` does not override source, payment, document type, or backend retry policy. Missing/invalid Rivhit configuration finalizes the claimed event as `configuration_required` without calling Rivhit. Payment and sale success remain unchanged when accounting fails.

Do not activate the Production `payment_success` mapping or create a real accounting document until the accountant/client has approved the exact document type and related numeric values.
