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
// Also set on Vercel (Dashboard → Settings → Environment Variables) if any
// server-side Vercel functions ever need them — currently only Supabase Edge uses them:
//   META_WHATSAPP_TOKEN
//   META_PHONE_NUMBER_ID
//   META_WABA_ID           (WhatsApp Business Account ID — for reference / future use)
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

    if (!rawPhone) return json({ ok: false, error: "missing phone" }, 400);
    if (!message) return json({ ok: false, error: "missing message" }, 400);

    const phone = normalizePhone(rawPhone);
    if (!phone) return json({ ok: false, error: `invalid phone number: "${rawPhone}"` }, 400);

    const apiUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

    const metaRes = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body: message },
      }),
    });

    // deno-lint-ignore no-explicit-any
    const metaData: any = await metaRes.json();

    if (!metaRes.ok) {
      const errMsg = metaData?.error?.message ?? `Meta API returned ${metaRes.status}`;
      return json({ ok: false, error: errMsg, meta: metaData }, metaRes.status < 500 ? metaRes.status : 502);
    }

    return json({ ok: true, messageId: metaData?.messages?.[0]?.id ?? null, to: phone });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
