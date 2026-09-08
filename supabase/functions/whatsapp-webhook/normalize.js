function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const DELIVERY_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function occurredAt(timestamp, fallback) {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : fallback;
}

function interactiveInput(interactive) {
  const reply = interactive?.button_reply ?? interactive?.list_reply;
  if (!reply?.id) return null;
  return { optionId: reply.id, text: reply.title ?? reply.id };
}

function normalizeMessage({ message, value, digest, receivedAt }) {
  const contact = value.contacts?.find((item) => item.wa_id === message.from) ?? value.contacts?.[0];
  let messageKind = "attachment";
  let input = { text: `unsupported_customer_message:${message.type ?? "unknown"}` };

  if (message.type === "text" && typeof message.text?.body === "string") {
    messageKind = "text";
    input = message.text.body.length <= 4096
      ? { text: message.text.body }
      : { text: "unsupported_customer_message:text_too_long" };
  } else if (message.type === "interactive") {
    const interactive = interactiveInput(message.interactive);
    if (interactive) {
      messageKind = "interactive";
      input = interactive;
    }
  }

  return {
    channel: "whatsapp",
    providerEventId: message.id,
    providerMessageId: message.id,
    eventKind: "message",
    payloadDigest: digest,
    occurredAt: occurredAt(message.timestamp, receivedAt),
    receivedAt,
    externalContactId: message.from,
    threadId: message.from,
    profileName: contact?.profile?.name ?? null,
    verifiedPhone: message.from ? `+${message.from.replace(/\D/gu, "")}` : null,
    verificationSource: "meta_whatsapp_signed_webhook",
    messageKind,
    input,
    sanitizedMetadata: {
      provider: "meta",
      messageType: message.type ?? "unknown",
      phoneNumberId: value.metadata?.phone_number_id ?? null,
    },
  };
}

function normalizeStatus({ status, value, digest, receivedAt }) {
  return {
    channel: "whatsapp",
    providerEventId: `${status.id}:${status.status}:${status.timestamp ?? "unknown"}`,
    providerMessageId: status.id,
    eventKind: "status",
    deliveryStatus: status.status,
    payloadDigest: digest,
    occurredAt: occurredAt(status.timestamp, receivedAt),
    receivedAt,
    sanitizedMetadata: {
      provider: "meta",
      phoneNumberId: value.metadata?.phone_number_id ?? null,
    },
  };
}

export async function normalizeWhatsAppWebhook(payload, { rawBody, receivedAt = new Date().toISOString() }) {
  const digest = await sha256(rawBody);
  const events = [];

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages") continue;
      const value = change.value ?? {};
      for (const message of value.messages ?? []) {
        if (message?.id && message?.from) events.push(normalizeMessage({ message, value, digest, receivedAt }));
      }
      for (const status of value.statuses ?? []) {
        if (status?.id && DELIVERY_STATUSES.has(status.status)) {
          events.push(normalizeStatus({ status, value, digest, receivedAt }));
        }
      }
    }
  }

  return events;
}
