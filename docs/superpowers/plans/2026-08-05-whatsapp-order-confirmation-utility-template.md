# WhatsApp Order-Confirmation Utility Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production “WA PDF” action send the `order_confirmation_pdf` Hebrew Utility template with the generated PDF in its document header, without breaking existing free-form WhatsApp, `wa.me`, or email behavior.

**Architecture:** Add small, dependency-injected JavaScript modules beside the Edge Function for request validation, template-status classification, media upload, and template sending; Vitest imports these modules from the existing app test suite. Keep `index.ts` as the HTTP/Deno adapter. Create the Meta template through a fixed-purpose, JWT-protected Edge Function that reads the existing server-side secret, then delete that bootstrap function only after the template is confirmed and its metadata recorded.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), Meta Graph API v25.0, React 18, Supabase JS, Vitest, Vite.

---

## File structure

- Create `supabase/functions/send-whatsapp/payload.js`: pure mode resolution, template validation, status classification, and Meta template payload construction.
- Create `supabase/functions/send-whatsapp/template-mode.js`: dependency-injected Meta template lookup, PDF upload, and template send orchestration.
- Modify `supabase/functions/send-whatsapp/index.ts`: preserve free-form paths and route explicit template requests through the new modules without logging credentials.
- Create `app/src/lib/sendWhatsappPayload.test.js`: tests the Edge Function modules through Vitest.
- Modify `app/src/components/orders/OrderConfirmationPDF.jsx`: make “WA PDF” always invoke template mode and map stable error codes to Hebrew messages.
- Modify `app/src/components/orders/OrderConfirmationPDF.test.jsx`: prove the UI sends exactly three ordered template parameters and retains the email path.
- Temporarily create and delete `supabase/functions/bootstrap-whatsapp-template/index.ts`: one-time template creation only; never commit it. Delete it only after successful template confirmation and metadata recording.
- Modify `PROGRESS.md`: record template ID/status, deployment, verification, and any Meta review gate.

### Task 1: Pure template request and payload contract

**Files:**
- Create: `app/src/lib/sendWhatsappPayload.test.js`
- Create: `supabase/functions/send-whatsapp/payload.js`

- [ ] **Step 1: Write failing validation and payload tests**

```js
import { describe, expect, test } from "vitest";
import {
  buildTemplatePayload,
  classifyTemplate,
  resolveMode,
  validateTemplateRequest,
} from "../../../supabase/functions/send-whatsapp/payload.js";

describe("send-whatsapp template payload", () => {
  test("keeps implicit free-form modes backward compatible", () => {
    expect(resolveMode({ message: "hello" })).toBe("text");
    expect(resolveMode({ message: "hello", pdfBase64: "cGRm" })).toBe("document");
  });

  test.each([[], ["a"], ["a", "b"], ["a", "b", "c", "d"], ["a", "", "c"]])(
    "rejects invalid body parameters %j",
    (bodyParameters) => {
      expect(validateTemplateRequest({
        pdfBase64: "cGRm",
        template: { name: "order_confirmation_pdf", language: "he", bodyParameters },
      })).toMatchObject({ ok: false, code: "template_parameter_mismatch" });
    },
  );

  test("builds a document-header template with three ordered text parameters", () => {
    expect(buildTemplatePayload({
      phone: "972501234567",
      mediaId: "media-1",
      fileName: "order.pdf",
      name: "order_confirmation_pdf",
      language: "he",
      bodyParameters: ["ישראל ישראלי", "ORD-1234", "15/08/2026"],
    })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "972501234567",
      type: "template",
      template: {
        name: "order_confirmation_pdf",
        language: { code: "he" },
        components: [
          { type: "header", parameters: [{ type: "document", document: { id: "media-1", filename: "order.pdf" } }] },
          { type: "body", parameters: [
            { type: "text", text: "ישראל ישראלי" },
            { type: "text", text: "ORD-1234" },
            { type: "text", text: "15/08/2026" },
          ] },
        ],
      },
    });
  });

  test.each([
    [[], "template_missing"],
    [[{ name: "order_confirmation_pdf", language: "he", status: "PENDING" }], "template_pending"],
    [[{ name: "order_confirmation_pdf", language: "he", status: "REJECTED", rejected_reason: "INVALID_FORMAT" }], "template_rejected"],
    [[{ name: "order_confirmation_pdf", language: "he", status: "PAUSED" }], "template_unavailable"],
  ])("classifies unavailable templates", (templates, code) => {
    expect(classifyTemplate(templates, "order_confirmation_pdf", "he")).toMatchObject({ ok: false, code });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test --prefix app -- src/lib/sendWhatsappPayload.test.js`

Expected: FAIL because `payload.js` does not exist.

- [ ] **Step 3: Implement the minimal pure contract**

```js
export const TEMPLATE_PARAMETER_COUNT = 3;

export function resolveMode(body = {}) {
  if (["template", "document", "text"].includes(body.mode)) return body.mode;
  return body.pdfBase64 ? "document" : "text";
}

export function validateTemplateRequest(body = {}) {
  const pdfBase64 = String(body.pdfBase64 ?? "").trim();
  const name = String(body.template?.name ?? "").trim();
  const language = String(body.template?.language ?? "").trim();
  const bodyParameters = Array.isArray(body.template?.bodyParameters)
    ? body.template.bodyParameters.map((value) => String(value ?? "").trim())
    : [];
  if (!pdfBase64) return { ok: false, code: "missing_pdf", error: "missing pdfBase64" };
  if (!name) return { ok: false, code: "template_missing", error: "missing template name" };
  if (!language) return { ok: false, code: "template_missing", error: "missing template language" };
  if (bodyParameters.length !== TEMPLATE_PARAMETER_COUNT || bodyParameters.some((value) => !value)) {
    return { ok: false, code: "template_parameter_mismatch", error: "template requires exactly 3 non-empty body parameters" };
  }
  return { ok: true, value: { pdfBase64, name, language, bodyParameters } };
}

export function classifyTemplate(templates, name, language) {
  const template = (templates ?? []).find((item) => item.name === name && item.language === language);
  if (!template) return { ok: false, code: "template_missing", error: `template ${name}/${language} not found` };
  const status = String(template.status ?? "").toUpperCase();
  if (status === "APPROVED") return { ok: true, template };
  if (status === "PENDING") return { ok: false, code: "template_pending", error: "template is pending Meta approval", template };
  if (status === "REJECTED") return { ok: false, code: "template_rejected", error: template.rejected_reason ?? "template was rejected", template };
  return { ok: false, code: "template_unavailable", error: `template status is ${status || "unknown"}`, template };
}

export function buildTemplatePayload({ phone, mediaId, fileName, name, language, bodyParameters }) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "template",
    template: {
      name,
      language: { code: language },
      components: [
        { type: "header", parameters: [{ type: "document", document: { id: mediaId, filename: fileName } }] },
        { type: "body", parameters: bodyParameters.map((text) => ({ type: "text", text })) },
      ],
    },
  };
}
```

- [ ] **Step 4: Run focused and complete verification**

Run: `npm test --prefix app -- src/lib/sendWhatsappPayload.test.js`

Expected: PASS.

Run: `npm test --prefix app && npm run build --prefix app`

Expected: all tests pass and build exits 0.

- [ ] **Step 5: Commit the tested contract**

```powershell
git add app/src/lib/sendWhatsappPayload.test.js supabase/functions/send-whatsapp/payload.js
git commit -m "feat: add WhatsApp template payload contract"
```

### Task 2: Template status, media upload, and send orchestration

**Files:**
- Modify: `app/src/lib/sendWhatsappPayload.test.js`
- Create: `supabase/functions/send-whatsapp/template-mode.js`
- Modify: `supabase/functions/send-whatsapp/index.ts`

- [ ] **Step 1: Add failing orchestration tests**

Add tests using a queued `fetchImpl` that prove:

```js
test("pending status stops before media upload", async () => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [
    { id: "t1", name: "order_confirmation_pdf", language: "he", status: "PENDING" },
  ] }), { status: 200 }));
  const result = await executeTemplateMode(templateArgs({ fetchImpl }));
  expect(result).toMatchObject({ status: 409, body: { ok: false, code: "template_pending" } });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("maps media upload and Meta send failures", async () => {
  const mediaFailure = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ data: [approvedTemplate] }))
    .mockResolvedValueOnce(jsonResponse({ error: { message: "upload failed" } }, 400));
  expect(await executeTemplateMode(templateArgs({ fetchImpl: mediaFailure })))
    .toMatchObject({ body: { code: "media_upload_failed" } });

  const sendFailure = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ data: [approvedTemplate] }))
    .mockResolvedValueOnce(jsonResponse({ id: "media-1" }))
    .mockResolvedValueOnce(jsonResponse({ error: { message: "send failed" } }, 400));
  expect(await executeTemplateMode(templateArgs({ fetchImpl: sendFailure })))
    .toMatchObject({ body: { code: "meta_send_failed" } });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test --prefix app -- src/lib/sendWhatsappPayload.test.js`

Expected: FAIL because `executeTemplateMode` is missing.

- [ ] **Step 3: Implement dependency-injected orchestration**

`executeTemplateMode` accepts `fetchImpl`, Graph URLs, token, normalized request data, PDF decoder, and filename. It performs exactly three fetches on success: template lookup, media upload, and message send. It returns `{ status, body }` and never returns or logs authorization data.

```js
export async function executeTemplateMode(args) {
  const lookup = await args.fetchImpl(args.templatesUrl, { headers: { Authorization: `Bearer ${args.token}` } });
  const lookupData = await lookup.json();
  if (!lookup.ok) return failure(502, "template_lookup_failed", metaMessage(lookupData, "template lookup failed"), lookupData);
  const availability = classifyTemplate(lookupData.data, args.name, args.language);
  if (!availability.ok) return failure(availability.code === "template_pending" ? 409 : 422, availability.code, availability.error, availability.template);

  let pdfBytes;
  try { pdfBytes = args.decodeBase64(args.pdfBase64); }
  catch { return failure(400, "invalid_pdf", "invalid pdfBase64"); }

  const formData = new FormData();
  formData.append("messaging_product", "whatsapp");
  formData.append("type", "application/pdf");
  formData.append("file", new Blob([pdfBytes], { type: "application/pdf" }), args.fileName);
  const upload = await args.fetchImpl(args.mediaUrl, { method: "POST", headers: { Authorization: `Bearer ${args.token}` }, body: formData });
  const uploadData = await upload.json();
  if (!upload.ok || !uploadData.id) return failure(502, "media_upload_failed", metaMessage(uploadData, "media upload failed"), uploadData);

  const payload = buildTemplatePayload({ ...args, mediaId: uploadData.id });
  const send = await args.fetchImpl(args.messagesUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const sendData = await send.json();
  if (!send.ok) return failure(502, "meta_send_failed", metaMessage(sendData, "Meta send failed"), sendData);
  return { status: 200, body: { ok: true, mode: "template", messageId: sendData.messages?.[0]?.id ?? null, to: args.phone, wa_id: sendData.contacts?.[0]?.wa_id ?? null } };
}
```

- [ ] **Step 4: Route template mode from `index.ts` and remove token-fragment logging**

Import the new modules, require `META_WABA_ID` for template mode, retain existing inference for old requests, require `message` only for free-form modes, and pass `GET /{WABA-ID}/message_templates?name=...&fields=id,name,status,category,language,rejected_reason` to `executeTemplateMode`. Delete the existing log that prints token prefix and suffix.

- [ ] **Step 5: Verify focused tests, complete tests, and build**

Run: `npm test --prefix app -- src/lib/sendWhatsappPayload.test.js`

Expected: PASS.

Run: `npm test --prefix app && npm run build --prefix app`

Expected: all tests pass and build exits 0.

- [ ] **Step 6: Commit Edge Function template mode**

```powershell
git add app/src/lib/sendWhatsappPayload.test.js supabase/functions/send-whatsapp/index.ts supabase/functions/send-whatsapp/template-mode.js
git commit -m "feat: add WhatsApp utility template sending"
```

### Task 3: Production “WA PDF” caller

**Files:**
- Modify: `app/src/components/orders/OrderConfirmationPDF.test.jsx`
- Modify: `app/src/components/orders/OrderConfirmationPDF.jsx`

- [ ] **Step 1: Write the failing UI invocation test**

```jsx
test("WA PDF always sends the approved Utility template contract", async () => {
  render(<OrderConfirmationPDF order={order} activity={activity} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "WA PDF" }));
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("send-whatsapp", {
    body: expect.objectContaining({
      mode: "template",
      phone: order.client_phone,
      template: {
        name: "order_confirmation_pdf",
        language: "he",
        bodyParameters: [order.client_name, order.order_number, "01/08/2026"],
      },
    }),
  }));
});
```

Add `client_phone` to the test order fixture.

- [ ] **Step 2: Run and verify RED**

Run: `npm test --prefix app -- src/components/orders/OrderConfirmationPDF.test.jsx`

Expected: FAIL because the current request lacks `mode` and `template`.

- [ ] **Step 3: Implement the fixed production template request**

Add constants and send:

```js
const ORDER_CONFIRMATION_TEMPLATE = {
  name: "order_confirmation_pdf",
  language: "he",
};

body: {
  mode: "template",
  phone: order.client_phone,
  pdfBase64,
  fileName,
  template: {
    ...ORDER_CONFIRMATION_TEMPLATE,
    bodyParameters: [
      String(order.client_name ?? "").trim(),
      String(order.order_number ?? "").trim(),
      dateFormatted,
    ],
  },
}
```

Map stable codes to clear Hebrew messages while retaining Meta's sanitized fallback error. Do not change `waLink`, `handleEmail`, `handleDownload`, or PDF rendering.

- [ ] **Step 4: Verify focused tests, all tests, and build**

Run: `npm test --prefix app -- src/components/orders/OrderConfirmationPDF.test.jsx`

Expected: PASS including existing email tests.

Run: `npm test --prefix app && npm run build --prefix app`

Expected: all tests pass and build exits 0.

- [ ] **Step 5: Commit the production caller**

```powershell
git add app/src/components/orders/OrderConfirmationPDF.jsx app/src/components/orders/OrderConfirmationPDF.test.jsx
git commit -m "feat: send order PDFs with WhatsApp utility template"
```

### Task 4: Create the Meta Utility template with a short-lived bootstrap function

**Files:**
- Temporarily create and delete: `supabase/functions/bootstrap-whatsapp-template/index.ts`

- [ ] **Step 1: Create the fixed-purpose bootstrap function**

The function must hard-check WABA `28097988189837294`, use public Meta app ID `1684280046173007`, read only `META_WHATSAPP_TOKEN`, never log it, build a valid sample PDF in memory, upload it through `/{APP-ID}/uploads`, and submit:

```json
{
  "name": "order_confirmation_pdf",
  "language": "he",
  "category": "UTILITY",
  "components": [
    {
      "type": "HEADER",
      "format": "DOCUMENT",
      "example": { "header_handle": ["<resumable-upload-handle>"] }
    },
    {
      "type": "BODY",
      "text": "שלום {{1}},\nמצורף אישור ההזמנה שלך לפעילות אצל שפן הסלע.\nמספר הזמנה: {{2}}\nתאריך הפעילות: {{3}}\nתודה,\nצוות שפן הסלע",
      "example": { "body_text": [["ישראל ישראלי", "ORD-1234", "15/08/2026"]] }
    }
  ]
}
```

It must query by exact name first and return an existing match rather than create a duplicate.

- [ ] **Step 2: Deploy with JWT verification and invoke using the existing local Supabase credential**

Run: `npx supabase functions deploy bootstrap-whatsapp-template`

Invoke the fixed endpoint with the existing local service-role credential without printing it. Capture only HTTP status and sanitized response.

- [ ] **Step 3: Confirm and record template metadata**

Require a successful Meta read showing the template ID, exact name, language, category, and current status. Record those sanitized values in the task evidence. If creation fails or the template cannot be confirmed, stop and report the sanitized failure; do not automatically delete the bootstrap function.

- [ ] **Step 4: Delete the bootstrap function after successful confirmation**

Verify the exact slug with `npx supabase functions list`, then run:

```powershell
npx supabase functions delete bootstrap-whatsapp-template --yes
```

Delete the local temporary file with `apply_patch`, verify the directory is empty and within the workspace, then remove the empty directory. Confirm `git status` shows no bootstrap function.

- [ ] **Step 5: Preserve the creation evidence**

Capture template ID, exact name, language, category, current status, and any sanitized Meta error/rejection. Do not perform a WhatsApp send unless status is `APPROVED`.

### Task 5: Deploy, status-gate, and production verification

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Run the complete pre-deployment gate**

Run:

```powershell
npm test --prefix app
npm run lint --prefix app
npm run typecheck --prefix app
npm run build --prefix app
git diff --check
```

Expected: tests, typecheck, and build exit 0; lint has no new errors; diff check is clean.

- [ ] **Step 2: Deploy only the verified production function**

Run: `npx supabase functions deploy send-whatsapp`

Then verify `send-whatsapp` is `ACTIVE`, JWT verification remains enabled, and no bootstrap function is present.

- [ ] **Step 3: Check template status without sending**

Use the Meta template creation response or a fresh read-only status query. If status is not `APPROVED`, stop before invoking the production send and report the review gate. If status is `APPROVED`, do not send automatically unless the user has supplied or reconfirmed the intended production recipient and order for the final test.

- [ ] **Step 4: Update progress documentation**

Record the exact template ID/status, implementation commits, deployed Edge Function version, completed tests, and remaining Meta approval or production-recipient validation action. Do not record credentials.

- [ ] **Step 5: Re-run tests/build and commit progress documentation**

Run: `npm test --prefix app && npm run build --prefix app`

Expected: all tests pass and build exits 0.

```powershell
git add PROGRESS.md
git commit -m "docs: record WhatsApp utility template rollout"
```

### Task 6: Final verification and handoff

**Files:**
- Verify only; no expected code changes.

- [ ] **Step 1: Verify repository and deployment state**

Run `git status --short`, `git log -5 --oneline`, `npx supabase functions list`, and `npx supabase secrets list`. Confirm the worktree is clean, logical commits exist, `send-whatsapp` is active/JWT-protected, the bootstrap function is absent after successful template confirmation, and the three existing Meta secret names are present. If template confirmation failed, report that the JWT-protected bootstrap function remains deployed as explicitly required.

- [ ] **Step 2: Verify requirement coverage**

Check every approved-spec requirement against the committed diff and test results: fixed Utility template, Hebrew/document header, exact parameter order, backward compatibility, explicit error codes, no credential logging, no send before approval, preserved email/`wa.me`, and deleted bootstrap.

- [ ] **Step 3: Report production checklists**

Provide template metadata, files and commits, deployments, verification commands/results, remaining manual Meta action, and two concise lists:

- Deployment checklist: Meta approval/payment/account readiness, Supabase secrets, deployed function/JWT status, frontend deployment, and template constants.
- Validation checklist: never-contacted recipient, closed 24-hour window, PDF opens, three body values render correctly, `wamid` returned, delivery webhook/recipient confirmation, and regression checks for email/`wa.me`/free-form modes.
