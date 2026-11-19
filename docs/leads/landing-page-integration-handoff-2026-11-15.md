# Landing page leads: read-only findings and activation handoff

> Historical checkpoint. Current findings and the revised Base44 contract are in
> [landing-page-integration-2026-11-19.md](landing-page-integration-2026-11-19.md).

Terminal 1 owns integration and production release. This branch changes only lead ingestion, lead display, tests, and lead-specific schema. No live website, production database, Edge deployment, customer record, or test submission was changed.

## What exists now

- The CRM is `public.leads` and the existing `/leads` page. Admin and operations roles can read and create leads. Historical Base44 leads were imported using `legacy_id`; the UI also creates manual leads and parses pasted text. These paths have no dedicated structured source field on the verified integration baseline.
- The WhatsApp bot creates a CRM lead when a handoff is recorded by `create_bot_handoff` in migration `026_chatbot_runtime.sql`. The production project lists `whatsapp-webhook` as active. Its behavior and data are untouched here.
- The current lead schema has no customer foreign key or automatic contact-matching flow. The separate `customers` table does not by itself link a matching phone or email to a lead. Existing lead source counts cannot be verified from the public site or Edge Function inventory alone.
- The verified integration baseline is `b243aac`, containing the last confirmed integrated release `4d509b0`. The current Vercel production alias was Ready at read-only inspection, but its manual deployment metadata does not expose a Git commit. The production Edge Function list contains no landing-lead function.
- This repository contains no public landing page, lead form submission handler, or landing-page webhook. The external site `https://www.shafan-hasela.com/` is WordPress/Elementor. Public HTML on the home page shows form ID `10db6ba`, post ID `3580`, and input IDs `name`, `email`, `message` (phone), plus honeypot `field_46ac48c` and reCAPTCHA v3. The contact page also shows form ID `3a84f9a`, post ID `2057`, with the same visible fields. Elementor's page script points form AJAX to WordPress `wp-admin/admin-ajax.php`. These are read-only observations, not a submitted test.
- Which of those forms, if any, Nurit calls the landing page is not yet confirmed. The WordPress **Actions After Submit**, email recipients, stored Elementor Submissions, hidden campaign fields, and any existing third-party forwarding are not exposed publicly. We cannot establish where past submissions ultimately went, whether they were lost or duplicated, or match individual submissions to CRM rows without WordPress access and a read-only production lead audit.

## New backend contract, disabled until the actual page is confirmed

`landing-lead-webhook` is a server-to-server Supabase Edge Function. It accepts only a JSON POST authenticated by `X-Landing-Timestamp` (Unix seconds) and `X-Landing-Signature: sha256=<hex HMAC-SHA256 of timestamp + "." + exact request body>`. Signatures expire after five minutes. The secret remains on the WordPress/server side and in Supabase Edge secrets; it must never appear in browser code or a webhook URL. The function is default OFF and requires explicit form-ID and page-host allowlists. This is a **new outbound adapter contract**, not a claim that the current Elementor form already sends it. Elementor's built-in Webhook action does not establish this signature contract; a reviewed server-side WordPress action/connector is required.

```json
{
  "formId": "10db6ba",
  "submittedAt": "2026-11-16T10:00:00.000Z",
  "pageUrl": "https://www.shafan-hasela.com/he/?utm_source=campaign",
  "fields": {
    "name": "<submitted name>",
    "phone": "<submitted phone; Elementor field ID message on the observed form>",
    "email": "<submitted email>",
    "company": "<only if the confirmed form collects it>"
  },
  "inquiry": "<only if the confirmed form collects it>",
  "campaign": "<only if known>",
  "utm": { "source": "campaign", "medium": "cpc", "campaign": "winter" },
  "submissionId": "<optional stable source ID for retries>"
}
```

The function normalizes the name, Israeli phone and email, checks all required fields, rejects nonempty honeypots, caps size, and accepts only configured form IDs and HTTPS hosts. It captures UTM values from explicit fields or the submitted page URL. It never stores the full raw request, remote IP, secret, or unrelated query parameters. Migration `202611150005_landing_lead_ingestion.sql` adds nullable `lead_source` and `lead_attribution` to the existing leads table, a private hash-only submission ledger, and a service-role-only atomic RPC. The RPC creates exactly one `landing_page` lead per stable submission key, returns the existing lead on replay, and limits accepted requests to three per contact and 100 globally per hour. It does not merge distinct inquiries with historical contacts based only on a matching phone or email. The existing Leads page displays the new source and campaign and includes them in CSV export with spreadsheet-formula escaping; historical leads remain unmodified.

## Required information and access

1. Nurit confirms the exact landing page URL(s), including campaign variants, and which form IDs feed this CRM. If the page is separate from `shafan-hasela.com`, obtain its form field IDs, submission mechanism, hosting owner, and server-side integration capability.
2. Read-only WordPress/Elementor admin access for the confirmed site, or an export/screenshots from **Elementor → Submissions** and each form's **Actions After Submit**, Webhook, Email and hidden-field settings. This establishes current delivery destinations and allows reconciliation of past submissions without altering them.
3. A WordPress administrator/developer able to install and maintain a small server-side form action that maps the confirmed fields to the signed JSON contract and reports non-2xx delivery for retry. Preserve the site's existing Collect Submissions, email, reCAPTCHA and honeypot behavior. If the actual page is on another platform, its owner must implement the same signed adapter or provide its verified webhook contract for a narrow adapter change.
4. Confirmation of which inquiry fields, campaign fields, and UTM values are actually available. Do not fabricate absent details.

## Controlled activation by terminal 1

1. Confirm the exact page/form and read-only historical submission path. Review the additive lead-only migration and apply it through the controlled database release. This migration has no payment dependencies, but its filename follows the pending physical migration in the repository; do not run an unreviewed bulk migration push.
2. Deploy `landing-lead-webhook` with JWT verification disabled **only for this endpoint**, while `LANDING_LEADS_ENABLED=false`. Configure a new random secret in both Supabase Edge and the site's server-side connector, plus `LANDING_LEADS_ALLOWED_FORM_IDS` and `LANDING_LEADS_ALLOWED_HOSTS`. Never put the secret in JavaScript, HTML, or the URL.
3. Enable the server-side adapter on the confirmed form and `LANDING_LEADS_ENABLED=true` in a controlled test window. Use one approved test identity/contact. Submit the real form once; verify WordPress accepted it, the webhook returned success, and exactly one row appears in the existing CRM with correct name, phone, email, inquiry, `landing_page`, page path and available campaign/UTM. Verify it is visible to authorized staff and no unexpected existing lead was changed.
4. Replay the same signed source submission or retry it through the site's delivery mechanism; verify the lead count remains one. Verify invalid signature and a different form ID do not create leads. Check the existing WhatsApp handoff-to-lead path remains operational. If the test succeeds, leave the connector and Edge gate enabled and monitor delivery failures. If a response was ambiguous, inspect the private submission ledger and CRM before retrying; its key makes a retry idempotent.

No live test lead was submitted. Production acceptance requires approval for the specific form and test contact, and the exact landing page URL is still missing.
