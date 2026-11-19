import { describe, expect, it, vi } from 'vitest';
import { createDeliveryHandler } from './handler.js';

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const actorId = id(1);
const quoteId = id(2);
const revisionId = id(3);
const requestId = id(4);
const body = () => ({
  action: 'send', requestId, quoteId, revisionId,
  pdfBase64: Buffer.from('%PDF-1.4\n%%EOF').toString('base64'),
});
const request = value => new Request('https://example.invalid/send-quote-email', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
});

function fixture() {
  let saved = null, bodyHash = null;
  const authorize = vi.fn(async () => ({ actorId, assertQuoteAccess: vi.fn(async () => {}) }));
  const repository = {
    getAttempt: vi.fn(async () => saved),
    loadRevision: vi.fn(async () => ({ client_name: 'לקוח בדיקה', client_email: 'synthetic@example.invalid', quote_number: 'SYN-1' })),
    claim: vi.fn(async input => { bodyHash = input.pdfHash; return { claimed: true, revision: { client_name: 'לקוח בדיקה', quote_number: 'SYN-1' },
      attempt: { id: input.requestId, quote_id: quoteId, revision_id: revisionId, channel: 'email', destination: 'synthetic@example.invalid', state: 'dispatched' } }; }),
    finish: vi.fn(async (id, actor, state) => { saved = { id, actor_id: actorId, quote_id: quoteId, revision_id: revisionId, channel: 'email', destination: 'synthetic@example.invalid', pdf_sha256: bodyHash, resend_of: null, state }; return saved; }),
  };
  const provider = { capabilities: vi.fn(async () => ({ canSend: true })), send: vi.fn(async () => 'synthetic-provider-id') };
  return { authorize, repository, provider, handler: createDeliveryHandler({ channel: 'email', authorize, repository, provider }) };
}

describe('quotation Edge dispatch', () => {
  it('rejects an unauthorized request before reading a quote or contacting a provider', async () => {
    const ctx = fixture();
    ctx.authorize.mockRejectedValue(new Error('authentication_required'));
    const response = await ctx.handler(request(body()));
    expect(response.status).toBe(503);
    expect(ctx.repository.loadRevision).not.toHaveBeenCalled();
    expect(ctx.provider.send).not.toHaveBeenCalled();
  });

  it('persists an uncertain send and replays its request id without a second provider call', async () => {
    const ctx = fixture();
    ctx.provider.send.mockRejectedValue(new Error('provider response lost'));
    const first = await (await ctx.handler(request(body()))).json();
    expect(first.attempt.state).toBe('uncertain');
    expect(ctx.repository.claim).toHaveBeenCalledOnce();
    expect(ctx.repository.finish).toHaveBeenCalledOnce();

    const replay = await (await ctx.handler(request(body()))).json();
    expect(replay.replayed).toBe(true);
    expect(replay.attempt.state).toBe('uncertain');
    expect(ctx.provider.send).toHaveBeenCalledOnce();
  });
});
