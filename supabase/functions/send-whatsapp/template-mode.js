import { buildTemplatePayload, classifyTemplate } from "./payload.js";
import { fetchWithTimeout, readJson } from "./network.js";

function failure(status, code, error, details) {
  return {
    status,
    body: {
      ok: false,
      code,
      error,
      ...(details ? { details } : {}),
    },
  };
}

function templateDetails(template) {
  if (!template) return undefined;
  const status = String(template.status ?? "unknown").slice(0, 40);
  const reason = String(template.rejected_reason ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return { status, ...(reason ? { reason } : {}) };
}

export async function executeTemplateMode(args) {
  const fields = "id,name,status,category,language,rejected_reason";
  const templatesUrl = `https://graph.facebook.com/v25.0/${encodeURIComponent(args.wabaId)}`
    + `/message_templates?name=${encodeURIComponent(args.name)}&fields=${encodeURIComponent(fields)}&limit=100`;
  const authorization = { Authorization: `Bearer ${args.token}` };

  const lookupResponse = await fetchWithTimeout(
    args.fetchImpl,
    templatesUrl,
    { headers: authorization },
    args.timeoutMs,
  );
  const lookupData = await readJson(lookupResponse);
  if (!lookupResponse.ok) {
    return failure(502, "template_lookup_failed", "Unable to check WhatsApp template status");
  }

  const availability = classifyTemplate(lookupData.data, args.name, args.language);
  if (!availability.ok) {
    return failure(
      availability.code === "template_pending" ? 409 : 422,
      availability.code,
      availability.error,
      templateDetails(availability.template),
    );
  }

  const formData = new FormData();
  formData.append("messaging_product", "whatsapp");
  formData.append("type", "application/pdf");
  formData.append("file", new Blob([args.pdfBytes], { type: "application/pdf" }), args.fileName);
  const mediaUrl = `https://graph.facebook.com/v25.0/${encodeURIComponent(args.phoneNumberId)}/media`;
  const uploadResponse = await fetchWithTimeout(
    args.fetchImpl,
    mediaUrl,
    { method: "POST", headers: authorization, body: formData },
    args.timeoutMs,
  );
  const uploadData = await readJson(uploadResponse);
  if (!uploadResponse.ok || !uploadData.id) {
    return failure(502, "media_upload_failed", "Unable to upload the PDF to WhatsApp");
  }

  const payload = buildTemplatePayload({ ...args, mediaId: uploadData.id });
  const messagesUrl = `https://graph.facebook.com/v25.0/${encodeURIComponent(args.phoneNumberId)}/messages`;
  const sendResponse = await fetchWithTimeout(
    args.fetchImpl,
    messagesUrl,
    {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    args.timeoutMs,
  );
  const sendData = await readJson(sendResponse);
  const messageId = sendData.messages?.[0]?.id;
  if (!sendResponse.ok || !messageId) {
    return failure(502, "meta_send_failed", "WhatsApp rejected the template message");
  }
  return { status: 200, body: { ok: true, mode: "template", messageId } };
}
