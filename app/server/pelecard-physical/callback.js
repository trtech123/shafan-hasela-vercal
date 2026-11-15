const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = status => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

// Pelecard callback content is deliberately untrusted and discarded. The URL
// identifies a frozen intent; GetTransaction and EMV detail lookup prove payment.
export function createPhysicalCallbackHandler(deps) {
  return async request => {
    if (request.method !== 'POST') return reply(405);
    if (deps.hostedEnabled !== true) return reply(503);
    const url = new URL(request.url);
    const paymentId = url.searchParams.get('paymentId');
    if (url.searchParams.size !== 1 || !uuid.test(paymentId ?? '')) return reply(400);
    const raw = await request.text();
    if (raw.length > 65_536) return reply(413);
    try {
      const intent = await deps.repository.status(paymentId);
      if (intent?.route !== 'hosted' || !intent.hostedTransactionId) return reply(404);
      await deps.workflow.verify(paymentId);
      return reply(200);
    } catch { return reply(503); }
  };
}
