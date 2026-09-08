export const EXPECTED_TEMPLATE = Object.freeze({
  name: "order_confirmation_pdf",
  language: "he",
});

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_PDF_LENGTH = Math.ceil(MAX_PDF_BYTES / 3) * 4 + 4;
const MAX_MESSAGE_LENGTH = 4096;
const MAX_TEMPLATE_PARAMETER_LENGTH = 1024;

function isValidTemplateDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return false;
  const [, day, month, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function resolveMode(body = {}) {
  if (body.mode === undefined || body.mode === null || body.mode === "") {
    return body.pdfBase64 ? "document" : "text";
  }
  return ["template", "document", "text"].includes(body.mode) ? body.mode : null;
}

export function normalizePhone(raw = "") {
  const digits = String(raw).replace(/\D/g, "");
  const normalized = digits.startsWith("0") ? `972${digits.slice(1)}` : digits;
  return normalized.length >= 9 && normalized.length <= 15 ? normalized : null;
}

export function validateMessage(message) {
  const value = String(message ?? "").trim();
  if (!value) {
    return { ok: false, code: "missing_message", error: "A message is required" };
  }
  if (value.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, code: "message_too_long", error: "The message is too long" };
  }
  return { ok: true, value };
}

export function validateTemplateRequest(body = {}) {
  const pdfBase64 = String(body.pdfBase64 ?? "").trim();
  const name = String(body.template?.name ?? "").trim();
  const language = String(body.template?.language ?? "").trim();
  const bodyParameters = Array.isArray(body.template?.bodyParameters)
    ? body.template.bodyParameters.map((value) => String(value ?? "").trim())
    : [];

  if (!pdfBase64) {
    return { ok: false, code: "missing_pdf", error: "A PDF is required" };
  }
  if (name !== EXPECTED_TEMPLATE.name || language !== EXPECTED_TEMPLATE.language) {
    return { ok: false, code: "invalid_template", error: "Unsupported WhatsApp template" };
  }
  if (
    bodyParameters.length !== 3
    || bodyParameters.some((value) => !value || value.length > MAX_TEMPLATE_PARAMETER_LENGTH)
    || !isValidTemplateDate(bodyParameters[2] ?? "")
  ) {
    return {
      ok: false,
      code: "template_parameter_mismatch",
      error: "The WhatsApp template requires exactly three non-empty parameters",
    };
  }
  return { ok: true, value: { pdfBase64, name, language, bodyParameters } };
}

function decodeBase64Strict(value) {
  const compact = String(value ?? "").trim();
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error("invalid base64");
  }
  const binary = atob(compact);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function decodeAndValidatePdf(pdfBase64, options = {}) {
  if (!options.decodeBase64 && String(pdfBase64 ?? "").trim().length > MAX_BASE64_PDF_LENGTH) {
    return {
      ok: false,
      code: "pdf_too_large",
      error: `The PDF exceeds the ${MAX_PDF_BYTES / 1024 / 1024} MiB limit`,
    };
  }
  let value;
  try {
    value = (options.decodeBase64 ?? decodeBase64Strict)(pdfBase64);
  } catch {
    return { ok: false, code: "invalid_pdf", error: "The PDF data is invalid" };
  }

  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return {
      ok: false,
      code: "pdf_too_large",
      error: `The PDF exceeds the ${MAX_PDF_BYTES / 1024 / 1024} MiB limit`,
    };
  }
  const tailStart = Math.max(0, bytes.byteLength - 1024);
  let hasEofMarker = false;
  for (let index = tailStart; index <= bytes.byteLength - 5; index += 1) {
    if (
      bytes[index] === 0x25
      && bytes[index + 1] === 0x25
      && bytes[index + 2] === 0x45
      && bytes[index + 3] === 0x4f
      && bytes[index + 4] === 0x46
    ) {
      hasEofMarker = true;
      break;
    }
  }
  if (
    bytes.byteLength < 5
    || bytes[0] !== 0x25
    || bytes[1] !== 0x50
    || bytes[2] !== 0x44
    || bytes[3] !== 0x46
    || bytes[4] !== 0x2d
    || !hasEofMarker
  ) {
    return { ok: false, code: "invalid_pdf_content", error: "The attachment is not a PDF" };
  }
  return { ok: true, value: bytes };
}

export function sanitizePdfFileName(fileName) {
  const cleaned = String(fileName ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .slice(0, 120);
  if (!cleaned) return "order.pdf";
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

export function classifyTemplate(templates, name, language) {
  const template = (Array.isArray(templates) ? templates : [])
    .find((item) => item?.name === name && item?.language === language);
  if (!template) {
    return { ok: false, code: "template_missing", error: "WhatsApp template was not found" };
  }

  const status = String(template.status ?? "").toUpperCase();
  const category = String(template.category ?? "").toUpperCase();
  if (status === "APPROVED" && category === "UTILITY") return { ok: true, template };
  if (status === "PENDING") {
    return { ok: false, code: "template_pending", error: "WhatsApp template is pending approval", template };
  }
  if (status === "REJECTED") {
    return { ok: false, code: "template_rejected", error: "WhatsApp template was rejected", template };
  }
  return {
    ok: false,
    code: "template_unavailable",
    error: "WhatsApp template is not approved",
    template,
  };
}

export function buildTextPayload({ phone, message }) {
  return {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: message },
  };
}

export function buildDocumentPayload({ phone, mediaId, fileName, message }) {
  return {
    messaging_product: "whatsapp",
    to: phone,
    type: "document",
    document: { id: mediaId, filename: fileName, caption: message },
  };
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
        {
          type: "header",
          parameters: [{ type: "document", document: { id: mediaId, filename: fileName } }],
        },
        {
          type: "body",
          parameters: bodyParameters.map((text) => ({ type: "text", text })),
        },
      ],
    },
  };
}
