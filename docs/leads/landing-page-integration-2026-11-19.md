# Nurit team-building leads: local integration handoff (2026-11-19)

> Historical design record. The 2026-11-23 requirement removes the WhatsApp continuation and changes the displayed source. Use `landing-page-activation-2026-11-23.md` and `base44-owner-handoff-he.md` for the current contract and release plan.

## Confirmed public route and remaining visibility limit

- `https://www.shafan-hasela.com/he/team-building-day/` currently contains one iframe with `src=https://vegan-climb-the-summit.base44.app/`. The outer page has no HTML form or input in the rendered DOM. The company's separate home/contact Elementor forms described in the 2026-11-15 checkpoint are **not** forms on this campaign page.
- Base44 currently renders the same lead form in two locations (hero and footer). It has name, phone, topic and optional message; **no email field**. Neither rendered instance has an HTML `action` or `method`; the copy says a prepared WhatsApp message opens, and the footer button says “שליחה בוואטסאפ”. The visible page also has a WhatsApp link to `wa.me/972503504478`. The identical rendered form does not prove component identity; the Base44 owner must check the private source for a shared component and submit handler. We did not submit either form, so a hidden database write cannot be ruled out. The public evidence does not establish a current CRM write.
- The campaign identifier is not visible on these URLs. Store campaign/UTM values only if the owner can actually supply them. The actual submitted page URL is the Base44 URL inside the iframe; the WordPress parent URL can be passed as a separate trusted field later if needed.
- The public WhatsApp destination is `+972503504478`. The bot receives messages through a configured Meta phone number ID; the repository does not disclose the linked public number. Before activation, verify whether this WhatsApp destination is actually handled by the bot. The correlation trigger is relevant only if it is.
- The Supabase landing webhook is only in this local branch. It is not deployed or enabled in Production. No public test lead was submitted.

## Local backend contract

The existing `landing-lead-webhook` Edge Function has been adapted to the Base44 form. Its `verify_jwt=false` setting is scoped to this function; every POST still needs `X-Landing-Timestamp` and `X-Landing-Signature: sha256=<HMAC-SHA256(secret, timestamp + "." + exact raw JSON body)>`. The key lives only in the Base44 backend function and Supabase Edge secrets. It must never be present in client JavaScript or a URL. The function is OFF unless `LANDING_LEADS_ENABLED=true`, and requires exact form ID and HTTPS page host allowlists. It rejects stale signatures, oversized/invalid data, unexpected hosts/forms, and honeypots. The private ledger and service-role RPC enforce one lead per submission ID and per-contact/global hourly limits. No customer details or raw request body are logged.

Example payload from the **Base44 server function** after a valid explicit form submission:

```json
{
  "formId": "nurit-team-building",
  "submissionId": "<one UUID generated for this form submission; reuse on retries>",
  "submittedAt": "<ISO-8601 timestamp>",
  "pageUrl": "https://vegan-climb-the-summit.base44.app/",
  "fields": { "name": "<name>", "phone": "<Israeli phone>" },
  "topic": "<selected topic>",
  "inquiry": "<optional message>",
  "campaign": "<only if actually known>",
  "utm": { "source": "<only if available>", "medium": "<only if available>", "campaign": "<only if available>" }
}
```

An email may be supplied in `fields.email` by a different confirmed form; it is optional for Base44. The RPC saves `full_name`, `phone`, optional `email` and `company`, inquiry in `source_text`, `status='פתוח'`, `lead_source='landing_page'`, and `lead_attribution` with `sourceLabel='דף נחיתה — יום גיבוש'`, canonical page URL/path, topic and any real campaign/UTM values. `created_at` uses the database default. The existing Leads screen shows the source, topic and campaign. The webhook returns `{accepted:true, duplicate:false|true, whatsappReference:'#SHF-<64 hex>'}` after persistence. `whatsappReference` is an opaque correlation value, not a credential.

## Work required in the Base44 project

The Base44 owner must inspect whether both rendered instances use one component and submit handler, plus any existing Base44 entity writes, automations or WhatsApp redirects. If another lead destination already exists, reconcile it before activation. Then:

1. Connect the shared submit handler **once**, at the component/action level, to one backend/server function for explicit form submissions. Do not add a second webhook call at each rendering site. If there are actually separate submit handlers, consolidate them into a single shared action first. Validate name, phone, topic and optional message, verify any Base44-supported anti-bot token server-side, and apply the project's existing spam controls. Give each distinct submission a UUID and retain it across network retries. The browser calls this Base44 function; it never calls Supabase directly with an HMAC secret.
2. The backend maps the shared form to the JSON above and POSTs the exact raw body with a current Unix-seconds timestamp and HMAC signature. Both rendered instances use the same `formId`; distinct submissions use distinct `submissionId` values. Configure the Supabase function URL and secret as Base44 **server-only** secrets. Treat non-2xx responses as failures; retry 5xx/429 using the same `submissionId` with backoff, and surface a failure state to the visitor if persistence cannot be confirmed. Do not show success or open WhatsApp after a failed CRM write.
3. After a 2xx `accepted:true`, the browser may open the existing prefilled WhatsApp message. Append the returned `whatsappReference` to that message as a separate line. If the visitor actually sends it, the existing bot stores the inbound text before any handoff. The local migration's narrow trigger then links that handoff to the already stored lead only when the verified WhatsApp sender phone matches the lead phone and both submission and message are recent. If WhatsApp is abandoned, the lead still exists. Ordinary WhatsApp conversations without the marker continue through the original path.
4. Confirm that the hero and footer instances both invoke that one shared action. Disable repeated clicks while a submission is pending and reuse its UUID on retry. Keep topic and message labels honest; update “שליחה בוואטסאפ” copy if CRM submission becomes the primary action.

The WordPress page owner currently only hosts the iframe. No WordPress form adapter is required for this page as rendered. If the owner adds a separate WordPress form, identify its form ID and submission path before adding it to the allowlist; it needs a server-side signed adapter and stable submission ID too.

## Local checks and controlled acceptance

The Vitest tests cover authentication, required/optional fields, source attribution, disabled/invalid requests, error handling, response and source ID behavior. The PGlite rehearsal executes the migration, stores a phone-only lead, confirms the initial status, source and topic, rejects duplicate submission IDs, rate-limits contacts, denies unauthorized RPC calls, links a marked WhatsApp handoff to the same lead, and confirms an ordinary handoff still creates its own lead. No network or Production database was used.

Before deployment: review migration order against the live schema, confirm the shared Base44 submit action and any prior lead writes, deploy the Edge Function disabled, set its allowlists to `nurit-team-building` and `vegan-climb-the-summit.base44.app`, add server-only secrets, and enable both sides in a controlled window. Only with explicit approval, run one end-to-end scenario using two distinct synthetic submissions: one from the hero instance and one from the footer instance. Verify exactly one `leads` row per submission (two total), then retry each with its original `submissionId` and verify the count stays two. If WhatsApp is sent, verify each handoff references its corresponding lead; test a normal WhatsApp handoff separately. Check source URL, topic, optional email, campaign/UTM where present, error monitoring and absence of personal data in logs. No deployment, migration or public submission has been performed in this task.
