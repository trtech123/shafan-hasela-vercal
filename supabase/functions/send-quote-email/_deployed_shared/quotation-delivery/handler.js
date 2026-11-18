import { DeliveryError, json, readJson, validateSendRequest, destinationFor, revisionForMessage, publicAttempt } from './contract.js';
export function createDeliveryHandler({ channel, authorize, repository, provider }) {
  return async request => {
    if (request.method === 'OPTIONS') return json({ ok: true });
    if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
    try {
      const caller = await authorize(request), actorId = caller.actorId ?? caller;
      const body = await readJson(request);
      if (body.action === 'capabilities' && Object.keys(body).length === 1) return json({ ok: true, ...await provider.capabilities() });
      const input = await validateSendRequest(body);
      if (caller.assertQuoteAccess) await caller.assertQuoteAccess(input.quoteId);
      const existing = await repository.getAttempt(input.requestId);
      if (existing) {
        if ((existing.resend_of ?? null) !== input.resendOf || existing.actor_id !== actorId || existing.quote_id !== input.quoteId || existing.revision_id !== input.revisionId || existing.channel !== channel || existing.pdf_sha256 !== input.pdfHash) throw new DeliveryError('delivery_request_conflict', 409);
        return json({ ok: true, attempt: publicAttempt(existing), replayed: true });
      }
      const revision = await repository.loadRevision(input.quoteId, input.revisionId);
      revisionForMessage(revision); destinationFor(channel, revision);
      const capabilities = await provider.capabilities();
      if (!capabilities.canSend) throw new DeliveryError(capabilities.reason || 'delivery_not_configured', 503);
      const claim = await repository.claim(input, channel, actorId);
      if (!claim.claimed) return json({ ok: true, attempt: publicAttempt(claim.attempt), replayed: true });
      let state = 'accepted', reason = null, providerId = null;
      try { providerId = await provider.send({ ...revisionForMessage(claim.revision), destination: claim.attempt.destination, pdfBytes: input.pdfBytes }); }
      catch (error) { state = error instanceof DeliveryError && error.state === 'failed' ? 'failed' : 'uncertain'; reason = error instanceof DeliveryError && ['provider_rejected', 'provider_timeout', 'provider_unavailable', 'provider_response_uncertain'].includes(error.code) ? error.code : 'provider_unavailable'; }
      let attempt;
      try { attempt = await repository.finish(input.requestId, actorId, state, reason, providerId); }
      catch { attempt = { ...claim.attempt, state: 'uncertain', reason: 'provider_response_uncertain' }; }
      return json({ ok: true, attempt: publicAttempt(attempt), replayed: false });
    } catch (error) {
      return json({ ok: false, code: error instanceof DeliveryError ? error.code : 'quotation_delivery_unavailable' }, error instanceof DeliveryError ? error.status : 503);
    }
  };
}
