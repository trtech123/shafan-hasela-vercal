// Edge Function: send-whatsapp
// Sends a text OR document (PDF) message via Meta WhatsApp Cloud API (v25.0).
//
// Text mode  — body: { phone, message }
// Document mode — body: { phone, message, pdfBase64, fileName }
//   1. Uploads PDF to Meta Media API (/media) → gets media_id
//   2. Sends document message with media_id + caption = message
//
// Phone normalization rules:
//   0501234567      → 972501234567
//   +972501234567   → 972501234567
//   972501234567    → unchanged
//
// Required secrets (Supabase Dashboard → Edge Functions → send-whatsapp → Secrets):
//   META_WHATSAPP_TOKEN    System User token from Meta developer console
//   META_PHONE_NUMBER_ID   e.g. 1215201798346282
//
// Deploy: npx supabase functions deploy send-whatsapp  (verify_jwt = true)

const GRAPH_VERSION = "v25.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  if (digits.length >= 9) return digits;
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const TOKEN = Deno.env.get("META_WHATSAPP_TOKEN");
    const PHONE_NUMBER_ID = Deno.env.get("META_PHONE_NUMBER_ID");

    console.log(
      `[send-whatsapp] secrets check — PHONE_NUMBER_ID="${PHONE_NUMBER_ID ?? "(missing)"}" TOKEN_LEN=${TOKEN?.length ?? 0}`,
    );

    if (!TOKEN || !PHONE_NUMBER_ID) {
      return json(
        { ok: false, error: "META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID not configured in Edge Function secrets" },
        500,
      );
    }

    // deno-lint-ignore no-explicit-any
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const rawPhone: string = (body?.phone ?? "").toString().trim();
    const message: string = (body?.message ?? "").toString().trim();
    const pdfBase64: string = (body?.pdfBase64 ?? "").toString().trim();
    const fileName: string = (body?.fileName ?? "order.pdf").toString().trim();

    const mode = pdfBase64 ? "document" : "text";
    console.log(`[send-whatsapp] invoked — mode=${mode} rawPhone="${rawPhone}" msgLen=${message.length}`);

    if (!rawPhone) return json({ ok: false, error: "missing phone" }, 400);
    if (!message) return json({ ok: false, error: "missing message" }, 400);

    const phone = normalizePhone(rawPhone);
    console.log(`[send-whatsapp] normalized phone: "${rawPhone}" → "${phone}"`);
    if (!phone) return json({ ok: false, error: `invalid phone number: "${rawPhone}"` }, 400);

    const messagesUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

    // ── DOCUMENT MODE ──────────────────────────────────────────────────────────
    if (mode === "document") {
      // Step 1: decode base64 → bytes
      let pdfBytes: Uint8Array;
      try {
        pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
      } catch (e) {
        console.error(`[send-whatsapp] base64 decode failed: ${String(e)}`);
        return json({ ok: false, error: "invalid pdfBase64" }, 400);
      }
      const pdfSizeKb = Math.round(pdfBytes.length / 1024);
      console.log(`[send-whatsapp] PDF decoded — size=${pdfSizeKb} KB fileName="${fileName}"`);

      // Step 2: upload to Meta Media API
      const mediaUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/media`;
      console.log(`[send-whatsapp] media upload → POST ${mediaUrl}`);

      const formData = new FormData();
      formData.append("messaging_product", "whatsapp");
      formData.append("type", "application/pdf");
      formData.append(
        "file",
        new Blob([pdfBytes], { type: "application/pdf" }),
        fileName,
      );

      const mediaRes = await fetch(mediaUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: formData,
      });
      // deno-lint-ignore no-explicit-any
      const mediaData: any = await mediaRes.json();
      console.log(
        `[send-whatsapp] media upload status=${mediaRes.status} body=${JSON.stringify(mediaData)}`,
      );

      if (!mediaRes.ok || !mediaData?.id) {
        const errMsg = mediaData?.error?.message ?? `Media upload failed (${mediaRes.status})`;
        console.error(`[send-whatsapp] media upload error: ${errMsg}`);
        return json({ ok: false, error: errMsg, meta: mediaData }, 502);
      }

      const mediaId: string = mediaData.id;
      console.log(`[send-whatsapp] media_id=${mediaId}`);

      // Step 3: send document message
      const docPayload = {
        messaging_product: "whatsapp",
        to: phone,
        type: "document",
        document: {
          id: mediaId,
          filename: fileName,
          caption: message,
        },
      };
      console.log(`[send-whatsapp] sending document → POST ${messagesUrl} payload=${JSON.stringify(docPayload)}`);

      const docRes = await fetch(messagesUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(docPayload),
      });
      // deno-lint-ignore no-explicit-any
      const docData: any = await docRes.json();
      console.log(
        `[send-whatsapp] document send status=${docRes.status} body=${JSON.stringify(docData)}`,
      );

      if (!docRes.ok) {
        const errMsg = docData?.error?.message ?? `Document send failed (${docRes.status})`;
        console.error(`[send-whatsapp] document send error: ${errMsg}`);
        return json(
          { ok: false, error: errMsg, meta: docData },
          docRes.status < 500 ? docRes.status : 502,
        );
      }

      const messageId = docData?.messages?.[0]?.id ?? null;
      const contactWaId = docData?.contacts?.[0]?.wa_id ?? null;
      console.log(
        `[send-whatsapp] document SUCCESS — messageId=${messageId} to=${phone} wa_id=${contactWaId}`,
      );
      return json({ ok: true, messageId, to: phone, wa_id: contactWaId, mode: "document" });
    }

    // ── TEXT MODE (unchanged) ───────────────────────────────────────────────────
    const textPayload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: message },
    };
    console.log(
      `[send-whatsapp] META REQUEST → POST ${messagesUrl} payload=${JSON.stringify(textPayload)}`,
    );
    console.log(
      `[send-whatsapp] token_prefix: ${TOKEN.slice(0, 12)}... token_suffix: ...${TOKEN.slice(-6)}`,
    );

    const metaRes = await fetch(messagesUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(textPayload),
    });

    // deno-lint-ignore no-explicit-any
    const metaData: any = await metaRes.json();
    console.log(`[send-whatsapp] META RESPONSE status=${metaRes.status} body=${JSON.stringify(metaData)}`);

    if (!metaRes.ok) {
      const errMsg = metaData?.error?.message ?? `Meta API returned ${metaRes.status}`;
      console.error(`[send-whatsapp] META ERROR: ${errMsg} full=${JSON.stringify(metaData?.error)}`);
      return json(
        { ok: false, error: errMsg, meta: metaData },
        metaRes.status < 500 ? metaRes.status : 502,
      );
    }

    const messageId = metaData?.messages?.[0]?.id ?? null;
    const contactWaId = metaData?.contacts?.[0]?.wa_id ?? null;
    console.log(`[send-whatsapp] text SUCCESS — messageId=${messageId} to=${phone} wa_id=${contactWaId}`);
    return json({ ok: true, messageId, to: phone, wa_id: contactWaId, mode: "text" });
  } catch (e) {
    console.error(`[send-whatsapp] EXCEPTION: ${String(e)}`);
    return json({ ok: false, error: String(e) }, 500);
  }
});
