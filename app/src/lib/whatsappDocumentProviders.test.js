import { afterEach, describe, expect, test, vi } from 'vitest';
import * as order from '../../../supabase/functions/send-order-whatsapp/_deployed_shared/order-delivery/template.js';
import * as quote from '../../../supabase/functions/send-quote-whatsapp/_deployed_shared/quotation-delivery/template.js';

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ['order confirmation', order, 'order_confirmation_pdf', ['Disposable customer', 'ORD-QA', '2026-10-09']],
  ['quotation', quote, 'quotation_pdf', ['Disposable customer', 'Q-QA']],
])('%s WhatsApp provider regression (no network)', (_label, module, name, bodyValues) => {
  function setup({ approved = true, rejected = false } = {}) {
    vi.stubGlobal('fetch', () => { throw new Error('Network is forbidden in this test'); });
    const calls = [];
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/message_templates?')) return Response.json({ data: [{
        name, language: 'he', category: 'UTILITY', status: approved ? 'APPROVED' : 'PENDING',
        components: [{ type: 'HEADER', format: 'DOCUMENT' }, { type: 'BODY', text: module.TEMPLATE_BODY }],
      }] });
      if (url.endsWith('/media')) return Response.json({ id: '123456' });
      if (url.endsWith('/messages')) return rejected
        ? Response.json({ error: { code: 131047 } }, { status: 400 })
        : Response.json({ messages: [{ id: 'wamid.disposable' }], contacts: [{ wa_id: '972500000000' }] });
      throw new Error('Unexpected provider operation');
    });
    const provider = module.createWhatsappProvider({ token: 'disposable-token', phoneId: '123', wabaId: '456', fetchImpl });
    const payload = {
      destination: '972500000000', pdfBytes: new TextEncoder().encode('%PDF-1.4\n%%EOF'),
      fileName: 'disposable.pdf', clientName: 'Disposable customer', quoteNumber: 'Q-QA',
      orderNumber: 'ORD-QA', activityDate: '2026-10-09',
    };
    return { calls, provider, payload };
  }

  test('approved Hebrew utility template uploads the PDF and accepts the reply ID', async () => {
    const { calls, provider, payload } = setup();
    expect((await provider.capabilities()).canSend).toBe(true);
    expect(await provider.send(payload)).toBe('wamid.disposable');
    expect(calls).toHaveLength(3);
    expect(calls[1].options.body.get('file').type).toBe('application/pdf');
    const request = JSON.parse(calls[2].options.body);
    expect(request.type).toBe('template');
    expect(request.template.name).toBe(name);
    expect(request.template.language.code).toBe('he');
    expect(request.template.components[0].parameters[0].document.id).toBe('123456');
    expect(request.template.components[1].parameters.map((p) => p.text)).toEqual(bodyValues);
  });

  test('unapproved utility template is unavailable', async () => {
    const { calls, provider } = setup({ approved: false });
    expect((await provider.capabilities()).canSend).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test('Graph rejection stays a failed send', async () => {
    const { provider, payload } = setup({ rejected: true });
    await expect(provider.send(payload)).rejects.toMatchObject({ message: 'provider_rejected' });
  });
});
