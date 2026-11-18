import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalHttpHandler } from './http.js';

const actor = { id: '11111111-1111-4111-8111-111111111111', role: 'cashier' };
const requestKey = '22222222-2222-4222-8222-222222222222';
const paymentId = '33333333-3333-4333-8333-333333333333';
const view = { paymentId, route: 'direct', state: 'reserved', registerNumber: '004', amountMinor: 2400, saleId: null };
function setup() {
  const calls = [];
  const deps = {
    authenticate: async token => token === 'valid' ? actor : null,
    enabled: true,
    repository: { viewByRequest: async () => view, cancelReserved: async () => { calls.push(['cancel']); return true; },
      listDevices: async () => [{ registerNumber: '004', workstationCode: 'FRONT_DESK', label: 'CT20 front', model: 'CT20' }] },
    workflow: {
      start: async input => { calls.push(['start', input]); return { id: paymentId, state: 'reserved' }; },
      startOrder: async input => { calls.push(['startOrder', input]); return { id: paymentId, state: 'reserved' }; },
      openHosted: async () => { calls.push(['openHosted']); },
      verify: async id => { calls.push(['verify', id]); return { state: 'uncertain' }; },
    },
  };
  const request = body => new Request('https://example.com/api/pelecard-physical', {
    method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { deps, calls, request };
}
test('authenticated prepare reserves a server-priced physical intent without dispatch', async () => {
  const s = setup();
  const response = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'prepare', requestKey,
    workstationCode: 'FRONT_DESK', cart: { lines: [{ kind: 'product', id: paymentId, qty: 1 }] },
    billing: { kind: 'person', name: 'Customer', identity: '123456789', email: 'test@example.com' } }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), view);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0][0], 'start');
  assert.equal(s.calls[0][1].actorId, actor.id);
});
test('physical actions admit every authenticated application role', async () => {
  const s = setup();
  s.deps.hostedEnabled = true;
  s.deps.hostedInitEnabled = true;
  s.deps.authenticate = async () => ({ id: actor.id, role: 'operations' });
  const prepare = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'prepareOrder',
    requestKey, workstationCode: 'FRONT_DESK', orderId: paymentId, amountMinor: 1500 }));
  const hosted = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'openHosted', requestKey }));
  assert.equal(prepare.status, 201);
  assert.equal(hosted.status, 200);
  assert.equal(s.calls[0][0], 'startOrder');
  s.deps.authenticate = async () => ({ id: actor.id, role: 'instructor' });
  assert.equal((await createPhysicalHttpHandler(s.deps)(s.request({ action: 'prepareOrder',
    requestKey, workstationCode: 'FRONT_DESK', orderId: paymentId, amountMinor: 1500 }))).status, 201);
});
test('order preparation passes only the order identity and requested amount to the physical workflow', async () => {
  const s = setup();
  const orderId = '44444444-4444-4444-8444-444444444444';
  const response = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'prepareOrder', requestKey,
    workstationCode: 'FRONT_DESK', orderId, amountMinor: 1200 }));
  assert.equal(response.status, 201);
  assert.deepEqual(s.calls, [['startOrder', { actorId: actor.id, actorRole: actor.role,
    workstationId: 'FRONT_DESK', requestKey, orderId, amountMinor: 1200 }]]);
  const polluted = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'prepareOrder', requestKey,
    workstationCode: 'FRONT_DESK', orderId, amountMinor: 1200, cart: { lines: [] } }));
  assert.equal(polluted.status, 400);
});
test('status and verify cannot dispatch a financial request', async () => {
  const s = setup();
  assert.equal((await createPhysicalHttpHandler(s.deps)(s.request({ action: 'status', requestKey }))).status, 200);
  assert.equal((await createPhysicalHttpHandler(s.deps)(s.request({ action: 'verify', requestKey }))).status, 200);
  assert.deepEqual(s.calls, [['verify', paymentId]]);
});
test('direct enqueue awaits durable acknowledgement for every authenticated role', async () => {
  const s = setup();
  s.deps.testActorId = '55555555-5555-4555-8555-555555555555';
  s.deps.dispatchEnabled = true;
  s.deps.cloudWorkerEnabled = true;
  s.deps.payperEnabled = true;
  s.deps.enqueueDirect = async id => { s.calls.push(['enqueue', id]); return 'message-1'; };
  const response = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'enqueueDirect', requestKey }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, 'reserved');
  assert.deepEqual(s.calls, [['enqueue', paymentId]]);
  s.deps.authenticate = async () => ({ id: actor.id, role: 'operations' });
  s.deps.repository.viewByRequest = async () => ({ ...view, state: 'pending' });
  assert.equal((await createPhysicalHttpHandler(s.deps)(s.request({ action: 'enqueueDirect', requestKey }))).status, 200);
  assert.deepEqual(s.calls, [['enqueue', paymentId]]);
});
test('enqueue failure never claims or sends J4 and can be retried with the same intent', async () => {
  const s = setup();
  s.deps.dispatchEnabled = true;
  s.deps.cloudWorkerEnabled = true;
  s.deps.payperEnabled = true;
  s.deps.enqueueDirect = async id => { s.calls.push(['enqueue', id]); if (s.calls.length === 1) throw Error('network'); };
  const handler = createPhysicalHttpHandler(s.deps);
  assert.equal((await handler(s.request({ action: 'enqueueDirect', requestKey }))).status, 502);
  assert.equal((await handler(s.request({ action: 'enqueueDirect', requestKey }))).status, 200);
  assert.deepEqual(s.calls, [['enqueue', paymentId], ['enqueue', paymentId]]);
});
test('direct enqueue refuses a charge while merchant Payper confirmation gate is off', async () => {
  const s = setup();
  s.deps.dispatchEnabled = true;
  s.deps.cloudWorkerEnabled = true;
  s.deps.payperEnabled = false;
  s.deps.enqueueDirect = async () => { throw Error('must not publish'); };
  assert.equal((await createPhysicalHttpHandler(s.deps)(s.request({ action: 'enqueueDirect', requestKey }))).status, 503);
});
test('hosted open is authenticated, separately gated, and returns only the saved session', async () => {
  const s = setup();
  s.deps.hostedEnabled = true;
  s.deps.hostedInitEnabled = true;
  s.deps.workflow.openHosted = async id => { s.calls.push(['openHosted', id]);
    return { state: 'pending' }; };
  const response = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'openHosted', requestKey }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).hostedAvailable, true);
  assert.deepEqual(s.calls, [['openHosted', paymentId]]);
  s.deps.hostedEnabled = false;
  assert.equal((await createPhysicalHttpHandler(s.deps)(s.request({ action: 'openHosted', requestKey }))).status, 503);
});
test('cancel only invokes the pre-dispatch reservation release', async () => {
  const s = setup();
  const response = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'cancel', requestKey }));
  assert.equal(response.status, 200);
  assert.deepEqual(s.calls, [['cancel']]);
});
test('staff can list enabled workstation assignments without credentials', async () => {
  const s = setup();
  const response = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'devices' }));
  assert.deepEqual(await response.json(), [{ registerNumber: '004', workstationCode: 'FRONT_DESK', label: 'CT20 front', model: 'CT20' }]);
});

test('staff can read unlinked provider document evidence for one order without financial writes', async () => {
  const s = setup();
  const evidence = [{ paymentId, paymentState: 'uncertain', amountMinor: 100,
    documentNumber: '200006', linked: false }];
  s.deps.repository.orderEvidence = async id => { s.calls.push(['orderEvidence', id]); return evidence; };
  const response = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'orderEvidence', orderId: paymentId }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), evidence);
  assert.deepEqual(s.calls, [['orderEvidence', paymentId]]);
});

test('only an administrator can list all unlinked provider documents', async () => {
  const s = setup();
  s.deps.repository.unlinkedEvidence = async () => { s.calls.push(['unlinkedEvidence']); return []; };
  const handler = createPhysicalHttpHandler(s.deps);
  assert.equal((await handler(s.request({ action: 'unlinkedEvidence' }))).status, 403);
  s.deps.authenticate = async () => ({ ...actor, role: 'admin' });
  assert.equal((await handler(s.request({ action: 'unlinkedEvidence' }))).status, 200);
  assert.deepEqual(s.calls, [['unlinkedEvidence']]);
});

test('direct capability is visible to every authenticated role and stays disabled before dispatch approval', async () => {
  const s = setup();
  const handler = createPhysicalHttpHandler(s.deps);
  s.deps.directUiEnabled = true;
  s.deps.testActorId = '55555555-5555-4555-8555-555555555555';
  assert.deepEqual(await (await handler(s.request({ action: 'capability' }))).json(),
    { visible: true, ready: false, route: 'direct', registerReady: true });
  s.deps.authenticate = async () => ({ id: '55555555-5555-4555-8555-555555555555', role: 'admin' });
  assert.deepEqual(await (await handler(s.request({ action: 'capability' }))).json(),
    { visible: true, ready: false, route: 'direct', registerReady: true });
  s.deps.authenticate = async () => ({ id: actor.id, role: 'operations' });
  assert.deepEqual(await (await handler(s.request({ action: 'capability' }))).json(),
    { visible: true, ready: false, route: 'direct', registerReady: true });
  s.deps.authenticate = async () => actor;
  s.deps.dispatchEnabled = true;
  s.deps.payperEnabled = true;
  s.deps.cloudWorkerEnabled = true;
  s.deps.workerMaxMs = 360000;
  assert.deepEqual(await (await handler(s.request({ action: 'capability' }))).json(),
    { visible: true, ready: true, route: 'direct', registerReady: true });
  s.deps.repository.listDevices = async () => [];
  assert.deepEqual(await (await handler(s.request({ action: 'capability' }))).json(),
    { visible: true, ready: false, route: 'direct', registerReady: false });
  assert.deepEqual(s.calls, []);
});

test('direct preview cannot reserve an order while financial dispatch is off', async () => {
  const s = setup();
  s.deps.directUiEnabled = true;
  const response = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'prepareOrder',
    requestKey, workstationCode: 'FRONT_DESK', orderId: paymentId, amountMinor: 1500 }));
  assert.equal(response.status, 503);
  assert.deepEqual(s.calls, []);
});
test('controlled acceptance exposes readiness only for its order and blocks all other reservations', async () => {
  const s = setup();
  const acceptedOrder = '44444444-4444-4444-8444-444444444444';
  s.deps.directUiEnabled = true;
  s.deps.dispatchEnabled = true;
  s.deps.payperEnabled = true;
  s.deps.cloudWorkerEnabled = true;
  s.deps.workerMaxMs = 360000;
  s.deps.acceptanceOrderId = acceptedOrder;
  s.deps.acceptanceAmountMinor = 1500;
  const handler = createPhysicalHttpHandler(s.deps);
  assert.equal((await (await handler(s.request({ action: 'capability' }))).json()).ready, false);
  assert.equal((await (await handler(s.request({ action: 'capability', orderId: paymentId }))).json()).ready, false);
  assert.equal((await (await handler(s.request({ action: 'capability', orderId: acceptedOrder }))).json()).ready, true);
  assert.equal((await handler(s.request({ action: 'prepare', requestKey,
    workstationCode: 'FRONT_DESK', cart: {}, billing: {} }))).status, 503);
  assert.equal((await handler(s.request({ action: 'prepareOrder', requestKey,
    workstationCode: 'FRONT_DESK', orderId: paymentId, amountMinor: 1500 }))).status, 503);
  assert.equal((await handler(s.request({ action: 'prepareOrder', requestKey,
    workstationCode: 'FRONT_DESK', orderId: acceptedOrder, amountMinor: 1400 }))).status, 503);
  assert.deepEqual(s.calls, []);
  assert.equal((await handler(s.request({ action: 'prepareOrder', requestKey,
    workstationCode: 'FRONT_DESK', orderId: acceptedOrder, amountMinor: 1500 }))).status, 201);
  assert.equal(s.calls.length, 1);
});
test('controlled acceptance cannot enqueue a different saved intent', async () => {
  const s = setup();
  s.deps.acceptanceOrderId = '44444444-4444-4444-8444-444444444444';
  s.deps.acceptanceAmountMinor = 1500;
  s.deps.dispatchEnabled = true;
  s.deps.payperEnabled = true;
  s.deps.cloudWorkerEnabled = true;
  s.deps.enqueueDirect = async () => { throw Error('must not enqueue'); };
  assert.equal((await createPhysicalHttpHandler(s.deps)(s.request({ action: 'enqueueDirect', requestKey }))).status, 503);
});
test('disabled or unauthorized requests cannot reserve', async () => {
  const s = setup(); s.deps.enabled = false;
  assert.equal((await createPhysicalHttpHandler(s.deps)(s.request({ action: 'prepare', requestKey,
    workstationCode: 'FRONT_DESK', cart: { lines: [] }, billing: {} }))).status, 503);
  const invalid = new Request('https://example.com/api/pelecard-physical', { method: 'POST',
    headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'status', requestKey }) });
  assert.equal((await createPhysicalHttpHandler(s.deps)(invalid)).status, 401);
});
