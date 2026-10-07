import { normalizeWhatsAppWebhook } from "./normalize.js";

const encoder = new TextEncoder();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return new Uint8Array(hex.match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)));
}

export async function verifyMetaSignature({ rawBody, signature, appSecret }) {
  if (!appSecret || !signature?.startsWith("sha256=")) return false;
  const signatureBytes = hexToBytes(signature.slice(7));
  if (!signatureBytes) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(rawBody));
}

export function createWhatsAppWebhookHandler({
  appSecret,
  verifyToken,
  processEvent,
  maxBodyBytes = 1_000_000,
  now = () => new Date(),
}) {
  return async function whatsappWebhookHandler(request) {
    if (!appSecret || !verifyToken) return json({ error: "webhook_not_configured" }, 500);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const valid = url.searchParams.get("hub.mode") === "subscribe"
        && url.searchParams.get("hub.verify_token") === verifyToken;
      if (!valid) return new Response("Forbidden", { status: 403 });
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }

    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > maxBodyBytes) return json({ error: "payload_too_large" }, 413);

    const rawBody = await request.text();
    if (encoder.encode(rawBody).byteLength > maxBodyBytes) return json({ error: "payload_too_large" }, 413);

    const validSignature = await verifyMetaSignature({
      rawBody,
      signature: request.headers.get("x-hub-signature-256"),
      appSecret,
    });
    if (!validSignature) return json({ error: "invalid_signature" }, 401);

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const events = await normalizeWhatsAppWebhook(payload, {
      rawBody,
      receivedAt: now().toISOString(),
    });
    try {
      for (const event of events) await processEvent(event);
    } catch {
      return json({ error: "processing_failed" }, 500);
    }
    return json({ received: true, events: events.length });
  };
}
