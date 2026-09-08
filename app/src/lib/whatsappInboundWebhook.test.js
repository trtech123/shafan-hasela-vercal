import { describe, expect, test, vi } from "vitest";
import {
  createWhatsAppWebhookHandler,
  verifyMetaSignature,
} from "../../../supabase/functions/whatsapp-webhook/handler.js";
import { normalizeWhatsAppWebhook } from "../../../supabase/functions/whatsapp-webhook/normalize.js";

const appSecret = "test-meta-app-secret";
const verifyToken = "test-verify-token";

function payloadWithMessage(message = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-1",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550000000", phone_number_id: "phone-1" },
          contacts: [{ profile: { name: "לקוחה" }, wa_id: "972501234567" }],
          messages: [{
            from: "972501234567",
            id: "wamid.in.1",
            timestamp: "1788872400",
            type: "text",
            text: { body: "שלום" },
            ...message,
          }],
        },
      }],
    }],
  };
}

async function signatureFor(body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `sha256=${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

describe("Meta WhatsApp webhook security", () => {
  test("returns the challenge only for the configured verification token", async () => {
    const handler = createWhatsAppWebhookHandler({ appSecret, verifyToken, processEvent: vi.fn() });
    const valid = await handler(new Request(`https://example.test/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=challenge-123`));
    const invalid = await handler(new Request("https://example.test/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=nope"));

    expect(valid.status).toBe(200);
    expect(await valid.text()).toBe("challenge-123");
    expect(invalid.status).toBe(403);
  });

  test("verifies the exact raw request bytes with HMAC SHA-256", async () => {
    const body = JSON.stringify(payloadWithMessage());
    const signature = await signatureFor(body);

    await expect(verifyMetaSignature({ rawBody: body, signature, appSecret })).resolves.toBe(true);
    await expect(verifyMetaSignature({ rawBody: `${body} `, signature, appSecret })).resolves.toBe(false);
    await expect(verifyMetaSignature({ rawBody: body, signature: "sha256=00", appSecret })).resolves.toBe(false);
  });

  test("rejects missing or invalid signatures before parsing or processing", async () => {
    const processEvent = vi.fn();
    const handler = createWhatsAppWebhookHandler({ appSecret, verifyToken, processEvent });
    const body = "not-json";
    const response = await handler(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=invalid" },
      body,
    }));

    expect(response.status).toBe(401);
    expect(processEvent).not.toHaveBeenCalled();
  });

  test("rejects an oversized payload without processing it", async () => {
    const processEvent = vi.fn();
    const handler = createWhatsAppWebhookHandler({ appSecret, verifyToken, processEvent, maxBodyBytes: 20 });
    const body = JSON.stringify(payloadWithMessage());
    const response = await handler(new Request("https://example.test/webhook", {
      method: "POST",
      headers: {
        "content-length": String(body.length),
        "x-hub-signature-256": await signatureFor(body),
      },
      body,
    }));

    expect(response.status).toBe(413);
    expect(processEvent).not.toHaveBeenCalled();
  });

  test("processes a valid signed payload and never forwards secrets or raw payload", async () => {
    const processEvent = vi.fn().mockResolvedValue({ status: "processed" });
    const handler = createWhatsAppWebhookHandler({ appSecret, verifyToken, processEvent });
    const body = JSON.stringify(payloadWithMessage());
    const response = await handler(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": await signatureFor(body) },
      body,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, events: 1 });
    expect(processEvent).toHaveBeenCalledWith(expect.objectContaining({
      channel: "whatsapp",
      providerEventId: "wamid.in.1",
      externalContactId: "972501234567",
      input: { text: "שלום" },
    }));
    const normalized = processEvent.mock.calls[0][0];
    expect(normalized).not.toHaveProperty("rawPayload");
    expect(JSON.stringify(normalized)).not.toContain(appSecret);
  });

  test("returns a generic retryable error when verified processing fails", async () => {
    const processEvent = vi.fn().mockRejectedValue(new Error("database secret detail"));
    const handler = createWhatsAppWebhookHandler({ appSecret, verifyToken, processEvent });
    const body = JSON.stringify(payloadWithMessage());
    const response = await handler(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": await signatureFor(body) },
      body,
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "processing_failed" });
  });
});

describe("Meta WhatsApp event normalization", () => {
  test("normalizes text and verified provider identity", async () => {
    const rawBody = JSON.stringify(payloadWithMessage());
    const [event] = await normalizeWhatsAppWebhook(JSON.parse(rawBody), { rawBody, receivedAt: "2026-09-08T14:00:00.000Z" });

    expect(event).toMatchObject({
      channel: "whatsapp",
      providerEventId: "wamid.in.1",
      providerMessageId: "wamid.in.1",
      eventKind: "message",
      externalContactId: "972501234567",
      threadId: "972501234567",
      profileName: "לקוחה",
      verifiedPhone: "+972501234567",
      verificationSource: "meta_whatsapp_signed_webhook",
      messageKind: "text",
      input: { text: "שלום" },
    });
    expect(event.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("normalizes interactive replies by stable option id", async () => {
    const payload = payloadWithMessage({
      type: "interactive",
      text: undefined,
      interactive: { type: "button_reply", button_reply: { id: "activities", title: "פעילויות ומתקנים" } },
    });
    const [event] = await normalizeWhatsAppWebhook(payload, { rawBody: JSON.stringify(payload), receivedAt: "2026-09-08T14:00:00.000Z" });

    expect(event.messageKind).toBe("interactive");
    expect(event.input).toEqual({ optionId: "activities", text: "פעילויות ומתקנים" });
  });

  test("turns unsupported customer attachments into handoff-safe input", async () => {
    const payload = payloadWithMessage({ type: "image", text: undefined, image: { id: "media-secret", caption: "צילום" } });
    const [event] = await normalizeWhatsAppWebhook(payload, { rawBody: JSON.stringify(payload), receivedAt: "2026-09-08T14:00:00.000Z" });

    expect(event.messageKind).toBe("attachment");
    expect(event.input).toEqual({ text: "unsupported_customer_message:image" });
    expect(event.sanitizedMetadata).not.toHaveProperty("mediaId");
  });

  test("normalizes delivery callbacks without customer routing fields", async () => {
    const payload = payloadWithMessage();
    const value = payload.entry[0].changes[0].value;
    delete value.messages;
    value.statuses = [{ id: "wamid.out.1", status: "delivered", timestamp: "1788872460", recipient_id: "972501234567" }];
    const [event] = await normalizeWhatsAppWebhook(payload, { rawBody: JSON.stringify(payload), receivedAt: "2026-09-08T14:00:00.000Z" });

    expect(event).toMatchObject({
      providerEventId: "wamid.out.1:delivered:1788872460",
      providerMessageId: "wamid.out.1",
      eventKind: "status",
      deliveryStatus: "delivered",
    });
    expect(event).not.toHaveProperty("input");
  });
});
