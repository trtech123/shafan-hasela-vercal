const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workstation = /^[A-Z][A-Z0-9_]{0,39}$/;
const json = (body, status) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const directDispatchReady = deps => deps.enabled === true && deps.dispatchEnabled === true &&
  deps.payperEnabled === true && deps.cloudWorkerEnabled === true &&
  Number.isSafeInteger(deps.workerMaxMs) && deps.workerMaxMs >= 330_000;

export function createPhysicalHttpHandler(deps) {
  const withinAcceptance = (orderId, amountMinor) => !deps.acceptanceOrderId ||
    (orderId === deps.acceptanceOrderId && amountMinor === deps.acceptanceAmountMinor);
  const withHosted = saved => deps.hostedEnabled === true && deps.hostedInitEnabled === true
    ? { ...saved, hostedAvailable: true } : saved;
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
      if (body.action === 'capability' &&
        (Object.keys(body).join(',') === 'action' ||
          (Object.keys(body).sort().join(',') === 'action,orderId' && uuid.test(body.orderId)))) {
        const direct = deps.directUiEnabled === true;
        const visible = deps.enabled === true && (direct || deps.hostedEnabled === true);
        const devices = visible ? await deps.repository.listDevices() : [];
        const registerReady = devices.some(device => device.registerNumber === '004' &&
          device.model === 'CT20' && typeof device.workstationCode === 'string' && device.workstationCode);
        const ready = visible && registerReady &&
          (!deps.acceptanceOrderId || body.orderId === deps.acceptanceOrderId) && (direct
          ? directDispatchReady(deps)
          : deps.hostedInitEnabled === true);
        return json({ visible, ready, route: direct ? 'direct' : 'hosted',
          registerReady: Boolean(registerReady) }, 200);
      }
      if (body.action === 'devices' && Object.keys(body).join(',') === 'action')
        return json(await deps.repository.listDevices(), 200);
      if (body.action === 'prepare') {
        if (!deps.enabled) return json({ error: 'physical_disabled' }, 503);
        if (deps.acceptanceOrderId) return json({ error: 'physical_acceptance_order_only' }, 503);
        if (deps.directUiEnabled === true && !directDispatchReady(deps))
          return json({ error: 'physical_direct_disabled' }, 503);
        if (Object.keys(body).sort().join(',') !== 'action,billing,cart,requestKey,workstationCode' ||
          !uuid.test(body.requestKey) || !workstation.test(body.workstationCode) ||
          !body.cart || !body.billing)
          return json({ error: 'invalid_input' }, 400);
        await deps.workflow.start({ actorId: actor.id, actorRole: actor.role,
          workstationId: body.workstationCode, requestKey: body.requestKey,
          cart: body.cart, billing: body.billing });
        const saved = await deps.repository.viewByRequest(actor.id, body.requestKey);
        return saved ? json(withHosted(saved), 201)
          : json({ error: 'reservation_unavailable' }, 502);
      }
      if (body.action === 'prepareOrder') {
        if (!deps.enabled) return json({ error: 'physical_disabled' }, 503);
        if (!withinAcceptance(body.orderId, body.amountMinor))
          return json({ error: 'physical_acceptance_order_only' }, 503);
        if (deps.directUiEnabled === true && !directDispatchReady(deps))
          return json({ error: 'physical_direct_disabled' }, 503);
        if (Object.keys(body).sort().join(',') !== 'action,amountMinor,orderId,requestKey,workstationCode' ||
          !uuid.test(body.requestKey) || !uuid.test(body.orderId) ||
          !workstation.test(body.workstationCode) || !Number.isSafeInteger(body.amountMinor) ||
          body.amountMinor < 1 || body.amountMinor > 2_147_483_647)
          return json({ error: 'invalid_input' }, 400);
        await deps.workflow.startOrder({ actorId: actor.id, actorRole: actor.role,
          workstationId: body.workstationCode, requestKey: body.requestKey,
          orderId: body.orderId, amountMinor: body.amountMinor });
        const saved = await deps.repository.viewByRequest(actor.id, body.requestKey);
        return saved ? json(withHosted(saved), 201)
          : json({ error: 'reservation_unavailable' }, 502);
      }
      if (!['status', 'verify', 'cancel', 'openHosted', 'enqueueDirect'].includes(body.action) ||
        Object.keys(body).sort().join(',') !== 'action,requestKey' || !uuid.test(body.requestKey))
        return json({ error: 'invalid_input' }, 400);
      let saved = await deps.repository.viewByRequest(actor.id, body.requestKey);
      if (!saved) return json({ error: 'payment_not_found' }, 404);
      if (deps.acceptanceOrderId && ['enqueueDirect', 'openHosted'].includes(body.action) &&
        !withinAcceptance(saved.orderId, saved.amountMinor))
        return json({ error: 'physical_acceptance_order_only' }, 503);
      if (body.action === 'enqueueDirect') {
        if (deps.enabled !== true || deps.dispatchEnabled !== true || deps.payperEnabled !== true ||
          deps.cloudWorkerEnabled !== true || typeof deps.enqueueDirect !== 'function')
          return json({ error: 'physical_direct_disabled' }, 503);
        if (saved.route !== 'direct' || saved.registerNumber !== '004')
          return json({ error: 'physical_direct_route_required' }, 409);
        if (saved.state === 'reserved') await deps.enqueueDirect(saved.paymentId);
        return json(saved, 200);
      }
      if (body.action === 'openHosted') {
        if (deps.hostedEnabled !== true || deps.hostedInitEnabled !== true)
          return json({ error: 'physical_hosted_disabled' }, 503);
        await deps.workflow.openHosted(saved.paymentId);
        saved = await deps.repository.viewByRequest(actor.id, body.requestKey);
      }
      if (body.action === 'cancel') {
        if (saved.state !== 'reserved' || !await deps.repository.cancelReserved(actor.id, body.requestKey))
          return json({ error: 'payment_already_dispatched' }, 409);
        saved = await deps.repository.viewByRequest(actor.id, body.requestKey);
      }
      if (body.action === 'verify' && (saved.state !== 'succeeded' ||
        (saved.route === 'hosted' && saved.documentState !== 'succeeded'))) {
        await deps.workflow.verify(saved.paymentId);
        saved = await deps.repository.viewByRequest(actor.id, body.requestKey);
      }
      return json(withHosted(saved), 200);
    } catch {
      return json({ error: 'payment_operation_unresolved' }, 502);
    }
  };
}
