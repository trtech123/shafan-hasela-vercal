# WhatsApp Order-Confirmation Utility Template Design

## Goal

Make the production `OrderConfirmationPDF` “WA PDF” action work for business-initiated conversations by always sending an approved Meta Utility message template with the generated order-confirmation PDF in a document header. Preserve the existing `wa.me`, email, and backward-compatible free-form WhatsApp paths.

## Production identifiers

- WABA ID: `28097988189837294`
- Phone Number ID: `1191274184075486`
- Template name: `order_confirmation_pdf`
- Category: `UTILITY`
- Language code: `he`
- Header format: `DOCUMENT`
- Existing Edge Function: `send-whatsapp`
- Token source: the existing Supabase secret `META_WHATSAPP_TOKEN`

The Meta token remains server-side. No implementation may print, return, commit, or log the token or any token fragment.

## Template definition

The template body is:

```text
שלום {{1}},
מצורף אישור ההזמנה שלך לפעילות אצל שפן הסלע.
מספר הזמנה: {{2}}
תאריך הפעילות: {{3}}
תודה,
צוות שפן הסלע
```

The body has exactly three positional text parameters:

1. Customer name
2. Order number
3. Activity date

Creation examples are `ישראל ישראלי`, `ORD-1234`, and `15/08/2026`.

## Template bootstrap lifecycle

A short-lived Supabase Edge Function performs the one-time Meta management workflow because only deployed Edge Functions can read the existing `META_WHATSAPP_TOKEN` secret without copying it elsewhere.

The bootstrap function:

1. Builds a minimal valid sample PDF in memory.
2. Creates a Meta resumable-upload session for that PDF using the existing Meta app.
3. Uploads the PDF bytes and obtains the returned header handle.
4. Checks WABA `28097988189837294` for an existing `order_confirmation_pdf` template.
5. If an exact matching template exists, it reports the existing template rather than creating a duplicate.
6. Otherwise it submits the Utility template with the document handle and body examples.
7. Returns only the template ID, exact name, language, category, status, and sanitized Meta validation/rejection details.

The bootstrap function is deployed without exposing any credential in source or responses, invoked once, and deleted from Supabase and the local workspace immediately after the creation attempt, whether the attempt succeeds or fails.

## `send-whatsapp` request contract

Template mode uses this explicit request body:

```json
{
  "mode": "template",
  "phone": "0501234567",
  "pdfBase64": "<base64-pdf>",
  "fileName": "אישור_הזמנה_ORD-1234.pdf",
  "template": {
    "name": "order_confirmation_pdf",
    "language": "he",
    "bodyParameters": ["ישראל ישראלי", "ORD-1234", "15/08/2026"]
  }
}
```

When `mode` is `template`, the Edge Function:

1. Validates the phone number, PDF, template name, language, and exactly three non-empty body parameters before any Meta write.
2. Reads the template by name from the configured WABA and requires an exact `name` and `language` match.
3. Stops before media upload when the template is missing, pending, paused, disabled, or rejected.
4. Uploads the PDF through `/{Phone-Number-ID}/media` only when the template status is `APPROVED`.
5. Sends `type: "template"` to `/{Phone-Number-ID}/messages` with:
   - a `header` component containing one `document` parameter with the uploaded media ID and filename;
   - a `body` component containing the three ordered text parameters.
6. Returns the Meta message ID and `mode: "template"` on acceptance.

The existing paths remain compatible:

- No explicit mode plus `pdfBase64`: existing free-form document mode with caption.
- No explicit mode and no PDF: existing free-form text mode.
- Explicit `mode: "document"` or `mode: "text"`: equivalent free-form behavior for future internal callers.

Template mode does not use a free-form caption because Meta template document headers do not support the existing document-caption field. The approved body carries the stable order-confirmation text, while the attached PDF contains the complete order details.

## Error contract

Structured failures return `ok: false`, a stable `code`, a human-readable `error`, and sanitized Meta details when useful:

- `template_missing`: no exact template name/language match.
- `template_pending`: template is awaiting approval.
- `template_rejected`: template status is rejected; include Meta rejection reason when returned.
- `template_unavailable`: template is paused, disabled, or otherwise not approved.
- `template_parameter_mismatch`: body parameters are not exactly three non-empty values.
- `media_upload_failed`: PDF upload failed or returned no media ID.
- `meta_send_failed`: Meta rejected the template send.
- Existing validation errors remain for missing/invalid phone, message, or PDF data.

No error response or log includes the Meta token. Logging records only operation mode, sanitized identifiers, HTTP status, file size, and Meta response bodies that do not contain request authorization headers.

## Frontend behavior

`OrderConfirmationPDF` keeps its existing PDF generation. The “WA PDF” handler always invokes `send-whatsapp` with `mode: "template"`, template name `order_confirmation_pdf`, language `he`, and the body parameters in this exact order:

1. `order.client_name`
2. `order.order_number`
3. The already formatted activity date (`DD/MM/YYYY`)

The `wa.me` link, email-with-PDF action, download action, PDF content, and older `OrderDocumentDialog` free-form WhatsApp action remain unchanged.

The frontend maps stable Edge Function error codes to clear Hebrew messages, distinguishing approval pending, rejected/missing template, bad parameters, media upload failure, and send failure.

## Approval and deployment gate

The Edge Function and UI may be deployed while the template is pending, because template mode blocks before media upload and returns `template_pending`. No real WhatsApp production send is attempted until a fresh Meta status query reports `APPROVED`.

Template status may be polled through Meta's Message Templates API. If review remains pending, implementation stops after deployment and reports the remaining action as waiting for Meta approval. If rejected, the rejection reason is reported and the template is not sent.

## Testing

Tests cover:

- Request validation rejects zero, fewer than three, more than three, or blank template parameters.
- Template payload construction uses a document header and three ordered body text parameters.
- Pending, rejected, missing, and unavailable template statuses stop before media upload.
- Media upload failures return `media_upload_failed`.
- Meta send failures return `meta_send_failed`.
- Existing text and free-form document requests retain their payloads.
- `OrderConfirmationPDF` invokes `send-whatsapp` with template mode and the exact three order-derived values.
- Existing email and rendering tests continue to pass.

Before any implementation commit, run the focused tests, the complete Vitest suite, lint, typecheck, and the production Vite build. Deploy only the verified `send-whatsapp` function. The short-lived bootstrap function is deleted immediately after its one-time use and is not committed as a permanent production function.

## Completion evidence

The final report includes:

- Template creation response, ID, exact name, language, category, status, and sanitized rejection/validation details.
- Files changed and commits created.
- Supabase deployments performed and confirmation that the bootstrap function was deleted.
- Test, lint, typecheck, and build results.
- Whether a production send was intentionally withheld due to non-approved status.
- Exact remaining manual action, if Meta review or account configuration blocks completion.
