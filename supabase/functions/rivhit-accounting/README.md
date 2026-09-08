# Rivhit accounting function

This server-side function creates standalone Rivhit accounting state for an existing Shafan order. It is not invoked by Pelecard or iCredit and has no frontend trigger in this phase.

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

The function accepts an authenticated `admin` or `operations` request:

```json
{
  "sourceType": "order",
  "sourceId": "<order UUID>",
  "documentTypeKey": "<configured mapping key>"
}
```

Do not deploy the function, apply migration `022_rivhit_accounting.sql`, or configure Production secrets without explicit approval and the accountant decisions listed in the design specification.
