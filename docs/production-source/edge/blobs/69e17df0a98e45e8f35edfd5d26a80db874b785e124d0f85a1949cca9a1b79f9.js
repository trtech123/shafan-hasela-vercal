import {
  buildDocumentPayload,
  buildTextPayload,
  decodeAndValidatePdf,
  normalizePhone,
  resolveMode,
  sanitizePdfFileName,
  validateMessage,
  validateTemplateRequest,
} from "./payload.js";
import { NetworkTimeoutError, fetchWithTimeout, readJson } from "./network.js";
import { executeTemplateMode } from "./template-mode.js";

const GRAPH_VERSION = "v25.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function uploadPdf({ fetchImpl, token, phoneNumberId, pdfBytes, fileName, timeoutMs }) {
  const formData = new FormData();
  formData.append("messaging_product", "whatsapp");
  formData.append("type", "application/pdf");
  formData.append("file", new Blob([pdfBytes], { type: "application/pdf" }), fileName);
  const response = await fetchWithTimeout(
    fetchImpl,
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/media`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    },
    timeoutMs,
  );
  const data = await readJson(response);
  return response.ok && data.id ? { ok: true, mediaId: data.id } : { ok: false };
}

async function sendPayload({ fetchImpl, token, phoneNumberId, payload, timeoutMs }) {
  const response = await fetchWithTimeout(
    fetchImpl,
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  );
  const data = await readJson(response);
  const messageId = data.messages?.[0]?.id;
  return response.ok && messageId ? { ok: true, messageId } : { ok: false };
}

export function createWhatsAppHandler({
  authorize,
  getEnv,
  fetchImpl = fetch,
  logger = console,
  timeoutMs = 15_000,
}) {
  return async function handleWhatsApp(request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") {
      return json({ ok: false, code: "method_not_allowed", error: "POST required" }, 405);
    }

    let mode = "unknown";
    try {
      const authorization = await authorize(request);
      if (!authorization.ok) return json(authorization.body, authorization.status);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, code: "invalid_request", error: "Invalid JSON request" }, 400);
      }

      mode = resolveMode(body);
      if (!mode) return json({ ok: false, code: "unsupported_mode", error: "Unsupported WhatsApp mode" }, 400);

      const phone = normalizePhone(body.phone);
      if (!phone) return json({ ok: false, code: "invalid_phone", error: "A valid phone number is required" }, 400);

      const token = getEnv("META_WHATSAPP_TOKEN");
      const phoneNumberId = getEnv("META_PHONE_NUMBER_ID");
      const wabaId = getEnv("META_WABA_ID");
      if (!token || !phoneNumberId || (mode === "template" && !wabaId)) {
        return json({ ok: false, code: "server_not_configured", error: "WhatsApp service is not configured" }, 500);
      }

      logger.info("[send-whatsapp] request", { mode });

      if (mode === "template") {
        const templateValidation = validateTemplateRequest(body);
        if (!templateValidation.ok) return json(templateValidation, 400);
        const pdfValidation = decodeAndValidatePdf(templateValidation.value.pdfBase64);
        if (!pdfValidation.ok) return json(pdfValidation, 400);
        const fileName = sanitizePdfFileName(body.fileName);
        logger.info("[send-whatsapp] pdf validated", { mode, bytes: pdfValidation.value.byteLength });
        const result = await executeTemplateMode({
          fetchImpl,
          token,
          phoneNumberId,
          wabaId,
          phone,
          pdfBytes: pdfValidation.value,
          fileName,
          name: templateValidation.value.name,
          language: templateValidation.value.language,
          bodyParameters: templateValidation.value.bodyParameters,
          timeoutMs,
        });
        if (!result.body.ok) logger.error("[send-whatsapp] request failed", { mode, code: result.body.code, status: result.status });
        return json(result.body, result.status);
      }

      const messageValidation = validateMessage(body.message);
      if (!messageValidation.ok) return json(messageValidation, 400);

      let payload;
      if (mode === "document") {
        const pdfValidation = decodeAndValidatePdf(String(body.pdfBase64 ?? "").trim());
        if (!pdfValidation.ok) return json(pdfValidation, 400);
        const fileName = sanitizePdfFileName(body.fileName);
        logger.info("[send-whatsapp] pdf validated", { mode, bytes: pdfValidation.value.byteLength });
        const upload = await uploadPdf({
          fetchImpl,
          token,
          phoneNumberId,
          pdfBytes: pdfValidation.value,
          fileName,
          timeoutMs,
        });
        if (!upload.ok) {
          logger.error("[send-whatsapp] request failed", { mode, code: "media_upload_failed", status: 502 });
          return json({ ok: false, code: "media_upload_failed", error: "Unable to upload the PDF to WhatsApp" }, 502);
        }
        payload = buildDocumentPayload({
          phone,
          mediaId: upload.mediaId,
          fileName,
          message: messageValidation.value,
        });
      } else {
        payload = buildTextPayload({ phone, message: messageValidation.value });
      }

      const sent = await sendPayload({ fetchImpl, token, phoneNumberId, payload, timeoutMs });
      if (!sent.ok) {
        logger.error("[send-whatsapp] request failed", { mode, code: "meta_send_failed", status: 502 });
        return json({ ok: false, code: "meta_send_failed", error: "WhatsApp rejected the message" }, 502);
      }
      logger.info("[send-whatsapp] request accepted", { mode });
      return json({ ok: true, mode, messageId: sent.messageId });
    } catch (error) {
      if (error instanceof NetworkTimeoutError || error?.code === "network_timeout") {
        logger.error("[send-whatsapp] request failed", { mode, code: "network_timeout", status: 504 });
        return json({ ok: false, code: "network_timeout", error: "WhatsApp did not respond in time" }, 504);
      }
      logger.error("[send-whatsapp] request failed", { mode, code: "internal_error", status: 500 });
      return json({ ok: false, code: "internal_error", error: "WhatsApp request failed" }, 500);
    }
  };
}
