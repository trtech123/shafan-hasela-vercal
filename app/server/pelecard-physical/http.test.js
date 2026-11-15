import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalHttpHandler } from './http.js';

const actor = { id: '11111111-1111-4111-8111-111111111111', role: 'cashier' };
const requestKey = '22222222-2222-4222-8222-222222222222';
const paymentId = '33333333-3333-4333-8333-333333333333';
const view = { paymentId, state: 'reserved', registerNumber: '004', amountMinor: 2400, saleId: null };
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
test('controlled activation admits only the selected cashier to reserve or open hosted EMV', async () => {
  const s = setup();
  s.deps.testActorId = '55555555-5555-4555-8555-555555555555';
  s.deps.hostedEnabled = true;
  s.deps.hostedInitEnabled = true;
  const prepare = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'prepareOrder',
    requestKey, workstationCode: 'FRONT_DESK', orderId: paymentId, amountMinor: 1500 }));
  const hosted = await createPhysicalHttpHandler(s.deps)(s.request({ action: 'openHosted', requestKey }));
  assert.equal(prepare.status, 403);
  assert.equal(hosted.status, 403);
  assert.deepEqual(s.calls, []);
  s.deps.testActorId = actor.id;
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
test('disabled or unauthorized requests cannot reserve', async () => {
  const s = setup(); s.deps.enabled = false;
  assert.equal((await createPhysicalHttpHandler(s.deps)(s.request({ action: 'prepare', requestKey,
    workstationCode: 'FRONT_DESK', cart: { lines: [] }, billing: {} }))).status, 503);
  const invalid = new Request('https://example.com/api/pelecard-physical', { method: 'POST',
    headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'status', requestKey }) });
  assert.equal((await createPhysicalHttpHandler(s.deps)(invalid)).status, 401);
});
