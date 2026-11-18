import {
  decodePdf,
  DeliveryError,
  normalizeQuotationPhone,
  validEmail,
} from "../quotation-delivery/contract.js";
export {
  DeliveryError,
  json,
  readJson,
  safeProviderId,
} from "../quotation-delivery/contract.js";
export const validId = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
export async function validateSendRequest(body) {
  if (
    !["send","manual_resend"].includes(body.action) ||
    Object.keys(body).some((k) =>
      !["action", "requestId", "orderId", "version", "pdfBase64", "recipient", "resendOf", "confirmed"]
        .includes(k)
    ) || !validId(body.requestId) || !validId(body.orderId) ||
    typeof body.version !== "string" || !/^[0-9a-f]{32}$/.test(body.version) ||
    (body.recipient !== undefined && typeof body.recipient !== "string") ||
    (body.action === "manual_resend" ? (!validId(body.resendOf) || body.resendOf.toLowerCase()===body.requestId?.toLowerCase() || body.confirmed!==true) : body.resendOf!==undefined || body.confirmed!==undefined)
  ) throw new DeliveryError("invalid_request");
  const pdfBytes = decodePdf(body.pdfBase64),
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256", pdfBytes));
  return {
    requestId: body.requestId.toLowerCase(),
    resendOf: body.action === "manual_resend" ? body.resendOf.toLowerCase() : null,
    orderId: body.orderId.toLowerCase(),
    version: body.version,
    recipient: body.recipient,
    pdfBytes,
    pdfHash: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    ),
  };
}
export function destinationFor(channel, data, override) {
  const raw = override === undefined
    ? (channel === "email" ? data.client_email : data.client_phone)
    : override;
  if (channel === "email") {
    const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!validEmail(value)) throw new DeliveryError("invalid_saved_email", 422);
    return value;
  }
  const phone = normalizeQuotationPhone(raw);
  if (!phone) throw new DeliveryError("invalid_saved_phone", 422);
  return phone;
}
export function revisionForMessage(data) {
  if (
    typeof data?.client_name !== "string" || !data.client_name.trim() ||
    data.client_name.length > 300 ||
    /[\u0000-\u001f\u007f]/.test(data.client_name) ||
    typeof data.order_number !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(data.order_number) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.activity_date)
  ) throw new DeliveryError("invalid_saved_order", 422);
  return {
    clientName: data.client_name,
    orderNumber: data.order_number,
    activityDate: data.activity_date.split("-").reverse().join("/"),
    fileName: `order-${data.order_number}.pdf`,
  };
}
export function publicAttempt(row) {
  return Object.fromEntries(
    [
      "id",
      "order_id",
      "version",
      "channel",
      "destination",
      "state",
      "reason",
      "provider_message_id",
      "pdf_sha256",
      "created_at",
      "dispatched_at",
      "finished_at",
      "resend_of",
      "attempt_type",
    ].map((k) => [k, row[k] ?? null]),
  );
}
