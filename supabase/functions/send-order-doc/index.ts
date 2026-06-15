// Edge Function: send-order-doc
// Production email via Gmail SMTP using nodemailer (npm:). Replaces denomailer,
// whose socket reader is incompatible with the Supabase Edge runtime (it failed
// with "invalid cmd at SMTPConnection.assertCode"). nodemailer's SMTP client
// works on edge via the npm: specifier + node compat.
//
// Sends the combined order-confirmation PDF (base64) as a real attachment,
// AS Info.shafan@gmail.com, to the order's client email.
//
// Request body (unchanged contract — frontend untouched):
//   { to, orderNumber?, clientName?, activityName?, activityDate?, pdfBase64?, fileName? }
//
// Secrets required (Supabase Dashboard → Edge Functions → Secrets):
//   GMAIL_USER           e.g. Info.shafan@gmail.com
//   GMAIL_APP_PASSWORD   16-char Google App Password (2FA enabled)
// Auth: verify_jwt = true (deploy WITHOUT --no-verify-jwt).

import nodemailer from "npm:nodemailer@6.9.14";

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

// Minimal HTML escape — order fields are staff-entered; guard against stray < & ".
function esc(s: string): string {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GMAIL_USER = Deno.env.get("GMAIL_USER");
    const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD");
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      return json({ ok: false, error: "GMAIL_USER / GMAIL_APP_PASSWORD not configured" }, 500);
    }

    // deno-lint-ignore no-explicit-any
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const to: string | undefined = body?.to;
    if (!to) {
      return json({ ok: false, error: "missing recipient (order.client_email)" }, 400);
    }

    const orderNumber: string = body?.orderNumber || "";
    const clientName: string = body?.clientName || "";
    const activityName: string = body?.activityName || "";
    const activityDate: string = body?.activityDate || "";
    const pdfBase64: string | undefined = body?.pdfBase64;
    const fileName: string = body?.fileName || "order-confirmation.pdf";

    const subject = `אישור הזמנה ${orderNumber} - שפן הסלע`.replace(/\s{2,}/g, " ").trim();

    const html =
      '<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7;color:#1e293b">' +
      `<p>שלום ${esc(clientName)},</p>` +
      `<p>מצורף אישור ההזמנה עבור פעילות ${esc(activityName)} בתאריך ${esc(activityDate)}.</p>` +
      "<p>המסמך כולל את פרטי ההזמנה, תנאי ההזמנה והצהרת הבריאות והבטיחות.<br>" +
      "נא להחזיר את הטופס מלא וחתום.</p>" +
      "<p>בברכה,<br>צוות שפן הסלע</p>" +
      "</div>";

    // Gmail SMTP over implicit TLS (465). From MUST equal the authenticated user.
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    // deno-lint-ignore no-explicit-any
    const message: any = {
      from: `שפן הסלע <${GMAIL_USER}>`,
      to,
      subject,
      html,
    };
    if (pdfBase64) {
      message.attachments = [
        {
          filename: fileName,
          content: pdfBase64,
          encoding: "base64",
          contentType: "application/pdf",
        },
      ];
    }

    const info = await transporter.sendMail(message);

    return json({ ok: true, messageId: info?.messageId ?? null, attached: !!pdfBase64 });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
