import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import nodemailer from 'npm:nodemailer@6.9.14';
import { corsHeaders, json, HttpError } from '../_shared/admin.ts';
import { sendVoucherEmail, validAccountingRecipient } from '../_shared/voucher-email.ts';

// No browser-supplied recipient, content, signature or attachment. This endpoint
// reads an immutable voucher and cannot invoke Rivhit or change a payment/order.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anon || !service) throw new HttpError(503, 'server_not_configured');
    const authorization = req.headers.get('Authorization');
    if (!authorization) throw new HttpError(401, 'authentication_required');
    const callerClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await callerClient.auth.getUser();
    if (authError || !auth.user) throw new HttpError(401, 'authentication_required');
    const { data: profile, error: profileError } = await callerClient.from('profiles').select('role').eq('id', auth.user.id).single();
    if (profileError || !['admin', 'operations', 'cashier'].includes(profile?.role)) throw new HttpError(403, 'staff_required');
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_email_request');
    const recipient = Deno.env.get('ACCOUNTING_EMAIL_TO') || '';
    const smtpUser = Deno.env.get('GMAIL_USER');
    const smtpPassword = Deno.env.get('GMAIL_APP_PASSWORD');
    const configured = Boolean(validAccountingRecipient(recipient) && smtpUser && smtpPassword);
    if (body.action === 'status' && Object.keys(body).length === 1) return json({ ok: true, configured });
    if (!configured) throw new HttpError(503, 'accounting_email_not_configured');
    const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await sendVoucherEmail(body, auth.user.id, recipient, {
      claim: async (voucherId, requestId, actorId, destination) => {
        const { data, error } = await db.rpc('claim_voucher_email', { p_voucher_id: voucherId, p_request_id: requestId, p_actor_id: actorId, p_recipient: destination });
        if (error) throw new HttpError(409, 'voucher_email_claim_rejected');
        return data;
      },
      finish: async (requestId, status, messageId) => {
        const { error } = await db.rpc('finish_voucher_email', { p_request_id: requestId, p_status: status, p_provider_message_id: messageId });
        if (error) throw new Error('voucher_email_audit_unavailable');
      },
      send: async (message) => {
        const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true,
          connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
          tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
          auth: { user: smtpUser, pass: smtpPassword } });
        try {
          const sent = await transport.sendMail({ from: smtpUser, ...message });
          if (!sent.accepted?.includes(recipient)) throw new Error('smtp_acceptance_uncertain');
          return { messageId: sent.messageId };
        } finally { transport.close(); }
      },
    });
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status);
    if (error instanceof Error && ['accounting_recipient_not_configured', 'invalid_email_request'].includes(error.message)) return json({ ok: false, error: error.message }, 400);
    return json({ ok: false, error: 'voucher_email_unavailable' }, 500);
  }
});
