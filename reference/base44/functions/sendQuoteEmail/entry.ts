import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { to, subject, htmlBody, pdfBase64, fileName } = await req.json();

  if (!to || !pdfBase64) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Send via Resend API
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    return Response.json({ error: 'RESEND_API_KEY not set' }, { status: 500 });
  }

  const payload = {
    from: "אדוונצ׳ר <onboarding@resend.dev>",
    to: [to],
    subject,
    html: htmlBody,
    attachments: [
      {
        filename: fileName || "document.pdf",
        content: pdfBase64,
      }
    ]
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok) {
    return Response.json({ error: data.message || 'Failed to send email' }, { status: 500 });
  }

  return Response.json({ success: true, id: data.id });
});