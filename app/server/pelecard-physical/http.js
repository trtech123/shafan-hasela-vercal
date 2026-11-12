const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workstation = /^[A-Z][A-Z0-9_]{0,39}$/;
const json = (body, status) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export function createPhysicalHttpHandler(deps) {
  return async request => {
    try {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '')?.[1];
      if (!token) return json({ error: 'unauthorized' }, 401);
      const actor = await deps.authenticate(token);
      if (!actor) return json({ error: 'unauthorized' }, 401);
      if (!['admin', 'cashier'].includes(actor.role)) return json({ error: 'forbidden' }, 403);
      const raw = await request.text();
      if (raw.length > 16_384) return json({ error: 'invalid_input' }, 400);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: 'invalid_input' }, 400); }
      if (!body || Array.isArray(body) || typeof body !== 'object')
        return json({ error: 'invalid_input' }, 400);
      if (body.action === 'devices' && Object.keys(body).join(',') === 'action')
        return json(await deps.repository.listDevices(), 200);
      if (body.action === 'prepare') {
        if (!deps.enabled) return json({ error: 'physical_disabled' }, 503);
        if (Object.keys(body).sort().join(',') !== 'action,billing,cart,requestKey,workstationCode' ||
          !uuid.test(body.requestKey) || !workstation.test(body.workstationCode) ||
          !body.cart || !body.billing)
          return json({ error: 'invalid_input' }, 400);
        await deps.workflow.start({ actorId: actor.id, actorRole: actor.role,
          workstationId: body.workstationCode, requestKey: body.requestKey,
          cart: body.cart, billing: body.billing });
        const saved = await deps.repository.viewByRequest(actor.id, body.requestKey);
        return saved ? json(saved, 201) : json({ error: 'reservation_unavailable' }, 502);
      }
      if (!['status', 'verify', 'cancel'].includes(body.action) ||
        Object.keys(body).sort().join(',') !== 'action,requestKey' || !uuid.test(body.requestKey))
        return json({ error: 'invalid_input' }, 400);
      let saved = await deps.repository.viewByRequest(actor.id, body.requestKey);
      if (!saved) return json({ error: 'payment_not_found' }, 404);
      if (body.action === 'cancel') {
        if (saved.state !== 'reserved' || !await deps.repository.cancelReserved(actor.id, body.requestKey))
          return json({ error: 'payment_already_dispatched' }, 409);
        saved = await deps.repository.viewByRequest(actor.id, body.requestKey);
      }
      if (body.action === 'verify' && saved.state !== 'succeeded') {
        await deps.workflow.verify(saved.paymentId);
        saved = await deps.repository.viewByRequest(actor.id, body.requestKey);
      }
      return json(saved, 200);
    } catch {
      return json({ error: 'payment_operation_unresolved' }, 502);
    }
  };
}
