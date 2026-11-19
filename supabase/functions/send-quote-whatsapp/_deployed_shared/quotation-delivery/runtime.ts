import { createClient } from 'npm:@supabase/supabase-js@2.106.1';
import nodemailer from 'npm:nodemailer@10.0.13';
import { DeliveryError, boundedOperation } from './contract.js';
import { createDeliveryHandler } from './handler.js';
import { createEmailProvider } from './smtp.js';
import { createWhatsappProvider } from './template.js';
import { createAuthorization } from './authorization.js';

export function quotationDelivery(channel: 'email' | 'whatsapp') {
  const env = (key: string) => Deno.env.get(key) || '';
  const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), service = env('SUPABASE_SERVICE_ROLE_KEY');
  const db = url && service ? createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  async function result(operation: () => PromiseLike<any>) {
    const { data, error } = await boundedOperation(operation, 10000, 'database_unavailable');
    if (error) {
      const allowed = ['delivery_resend_parent_invalid','delivery_resend_stale','delivery_still_in_progress','delivery_request_conflict', 'quotation_revision_stale', 'quotation_delivery_already_claimed', 'quotation_not_found', 'quotation_revision_not_found', 'invalid_saved_email', 'invalid_saved_phone'];
      throw new DeliveryError(allowed.includes(error.message) ? error.message : 'quotation_delivery_database_unavailable', error.code === 'PT409' ? 409 : error.code === 'PT404' ? 404 : 503);
    }
    return data;
  }
  return createDeliveryHandler({ channel,
    authorize: createAuthorization({ url, anon, configured: Boolean(db), createClient, scoped:true }),
    repository: {
      getAttempt: (id: string) => result(() => db!.from('quotation_delivery_attempts').select('*').eq('id', id).maybeSingle()),
      loadRevision: async (quoteId: string, revisionId: string) => {
        const row = await result(() => db!.from('quotation_revisions').select('data').eq('id', revisionId).eq('quote_id', quoteId).maybeSingle());
        if (!row) throw new DeliveryError('quotation_revision_not_found', 404); return row.data;
      },
      claim: (input: any, selectedChannel: string, actorId: string) => result(() => db!.rpc(input.resendOf?'claim_manual_quotation_delivery':'claim_quotation_delivery', { p_request_id: input.requestId, p_quote_id: input.quoteId, p_revision_id: input.revisionId, p_channel: selectedChannel, p_actor_id: actorId, p_pdf_sha256: input.pdfHash,...(input.resendOf?{p_resend_of:input.resendOf}:{}) })),
      finish: (requestId: string, actorId: string, state: string, reason: string | null, providerId: string | null) => result(() => db!.rpc('finish_quotation_delivery', { p_request_id: requestId, p_actor_id: actorId, p_state: state, p_reason: reason, p_provider_message_id: providerId })),
    },
    provider: channel === 'email' ? createEmailProvider({ user: env('GMAIL_USER'), password: env('GMAIL_APP_PASSWORD'), createTransport: nodemailer.createTransport }) : createWhatsappProvider({ token: env('META_WHATSAPP_TOKEN'), phoneId: env('META_PHONE_NUMBER_ID'), wabaId: env('META_WABA_ID') }),
  });
}
