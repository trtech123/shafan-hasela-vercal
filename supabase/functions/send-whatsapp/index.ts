// Edge Function: send-whatsapp
// Sends a text message via Meta WhatsApp Cloud API (v25.0).
//
// Request body: { phone: string, message: string }
//
// Phone normalization rules:
//   0501234567      → 972501234567
//   +972501234567   → 972501234567
//   972501234567    → unchanged
//
// Required secrets — add via Supabase Dashboard → Edge Functions → send-whatsapp → Secrets
// (never put these in client code or the repo):
//   META_WHATSAPP_TOKEN    permanent or temporary System User token from Meta developer console
//   META_PHONE_NUMBER_ID   e.g. 1215201798346282 (test number or production number)
//
// Phase 1: text-only. PDF/document sending comes after text is verified working.
// Auth: verify_jwt = true  →  deploy with:
//   npx supabase functions deploy send-whatsapp
//   (no --no-verify-jwt flag)

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

// Strip non-digits, then apply Israeli prefix rules.
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  // International without country code but long enough (9+ digits)
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

    console.log(`[send-whatsapp] secrets check — PHONE_NUMBER_ID="${PHONE_NUMBER_ID ?? "(missing)"}" TOKEN_LEN=${TOKEN?.length ?? 0}`);

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

    console.log(`[send-whatsapp] invoked — rawPhone="${rawPhone}" msgLen=${message.length}`);

    if (!rawPhone) return json({ ok: false, error: "missing phone" }, 400);
    if (!message) return json({ ok: false, error: "missing message" }, 400);

    const phone = normalizePhone(rawPhone);
    console.log(`[send-whatsapp] normalized phone: "${rawPhone}" → "${phone}"`);
    if (!phone) return json({ ok: false, error: `invalid phone number: "${rawPhone}"` }, 400);

    const apiUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

    // Complete request payload (token excluded for security)
    const metaPayload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: message },
    };
    console.log(`[send-whatsapp] META REQUEST → POST ${apiUrl}`);
    console.log(`[send-whatsapp] META REQUEST payload: ${JSON.stringify(metaPayload)}`);
    console.log(`[send-whatsapp] META REQUEST token_prefix: ${TOKEN.slice(0, 12)}... token_suffix: ...${TOKEN.slice(-6)}`);

    const metaRes = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metaPayload),
    });

    // deno-lint-ignore no-explicit-any
    const metaData: any = await metaRes.json();
    console.log(`[send-whatsapp] META RESPONSE status=${metaRes.status}`);
    console.log(`[send-whatsapp] META RESPONSE body: ${JSON.stringify(metaData)}`);

    // Log the messaging_product and contacts array from the response for delivery diagnosis
    if (metaData?.contacts) {
      console.log(`[send-whatsapp] META contacts: ${JSON.stringify(metaData.contacts)}`);
    }
    if (metaData?.messages) {
      console.log(`[send-whatsapp] META messages: ${JSON.stringify(metaData.messages)}`);
    }

    if (!metaRes.ok) {
      const errMsg = metaData?.error?.message ?? `Meta API returned ${metaRes.status}`;
      console.error(`[send-whatsapp] META ERROR: ${errMsg}`);
      console.error(`[send-whatsapp] META ERROR full: ${JSON.stringify(metaData?.error)}`);
      return json({ ok: false, error: errMsg, meta: metaData }, metaRes.status < 500 ? metaRes.status : 502);
    }

    const messageId = metaData?.messages?.[0]?.id ?? null;
    const contactWaId = metaData?.contacts?.[0]?.wa_id ?? null;
    const contactInput = metaData?.contacts?.[0]?.input ?? null;
    console.log(`[send-whatsapp] SUCCESS — messageId=${messageId} to=${phone} wa_id=${contactWaId} input=${contactInput}`);

    // wa_id is the WhatsApp-resolved phone. If it differs from `phone`, Meta remapped it.
    if (contactWaId && contactWaId !== phone) {
      console.log(`[send-whatsapp] NOTE: Meta resolved phone ${phone} → wa_id ${contactWaId}`);
    }

    return json({ ok: true, messageId, to: phone, wa_id: contactWaId });
  } catch (e) {
    console.error(`[send-whatsapp] EXCEPTION: ${String(e)}`);
    return json({ ok: false, error: String(e) }, 500);
  }
});
