import { boundedOperation, DeliveryError, readJson, safeProviderId } from './contract.js';
export const TEMPLATE_BODY = 'שלום {{1}}, מצורפת הצעת המחיר מספר {{2}} שביקשת משפן הסלע. ניתן לעיין בפרטים במסמך המצורף.';
const BASE = 'https://graph.facebook.com/v25.0';
export function compatibleTemplate(template) {
  if (template?.name !== 'quotation_pdf' || template.language !== 'he' || template.category !== 'UTILITY' || template.status !== 'APPROVED' || !Array.isArray(template.components) || template.components.length !== 2) return false;
  const header = template.components.find(x => x.type === 'HEADER'); const body = template.components.find(x => x.type === 'BODY');
  return header?.format === 'DOCUMENT' && body?.text === TEMPLATE_BODY;
}
export function createWhatsappProvider({ token, phoneId, wabaId, fetchImpl = fetch, timeoutMs = 15000 }) {
  const configured = Boolean(token && /^\d{1,30}$/.test(phoneId || '') && /^\d{1,30}$/.test(wabaId || ''));
  const headers = { Authorization: `Bearer ${token}` };
  async function call(url, options) {
    return boundedOperation(async signal => {
      const response = await fetchImpl(url, { ...options, signal });
      let body; try { body = await readJson(response, 1024 * 1024, timeoutMs); } catch { throw new DeliveryError('provider_response_uncertain', 502, 'uncertain'); }
      if (!response.ok) throw new DeliveryError(response.status >= 400 && response.status < 500 && response.status !== 408 ? 'provider_rejected' : 'provider_unavailable', 502, response.status >= 400 && response.status < 500 && response.status !== 408 ? 'failed' : 'uncertain');
      return body;
    }, timeoutMs);
  }
  return {
    async capabilities() {
      const template = { name: 'quotation_pdf', language: 'he', category: 'UTILITY', status: null, compatible: false };
      if (!configured) return { configured: false, canSend: false, reason: 'whatsapp_not_configured', template };
      try {
        const result = await call(`${BASE}/${wabaId}/message_templates?name=quotation_pdf&fields=id,name,status,category,language,components&limit=100`, { method: 'GET', headers });
        const matches = Array.isArray(result.data) ? result.data.filter(x => x.name === 'quotation_pdf' && x.language === 'he') : [];
        const match = matches.length === 1 ? matches[0] : null;
        template.status = typeof match?.status === 'string' && /^[A-Z_]{1,40}$/.test(match.status) ? match.status : null;
        template.compatible = compatibleTemplate(match);
        return { configured: true, canSend: template.compatible, reason: template.compatible ? null : 'whatsapp_template_unavailable', template };
      } catch { return { configured: true, canSend: false, reason: 'whatsapp_template_lookup_unavailable', template }; }
    },
    async send({ destination, pdfBytes, clientName, quoteNumber, fileName }) {
      const form = new FormData(); form.set('messaging_product', 'whatsapp'); form.set('type', 'application/pdf'); form.set('file', new Blob([pdfBytes], { type: 'application/pdf' }), fileName);
      const upload = await call(`${BASE}/${phoneId}/media`, { method: 'POST', headers, body: form });
      if (typeof upload.id !== 'string' || !/^\d{1,100}$/.test(upload.id)) throw new DeliveryError('provider_response_uncertain', 502, 'uncertain');
      const result = await call(`${BASE}/${phoneId}/messages`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: destination, type: 'template', template: { name: 'quotation_pdf', language: { code: 'he' }, components: [
        { type: 'header', parameters: [{ type: 'document', document: { id: upload.id, filename: fileName } }] },
        { type: 'body', parameters: [{ type: 'text', text: clientName }, { type: 'text', text: quoteNumber }] },
      ] } }) });
      const id = safeProviderId(result.messages?.[0]?.id);
      if (!id || result.messages.length !== 1 || result.contacts?.[0]?.wa_id !== destination) throw new DeliveryError('provider_response_uncertain', 502, 'uncertain');
      return id;
    },
  };
}
