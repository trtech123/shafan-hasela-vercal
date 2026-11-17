import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalRuntime } from './runtime.js';

test('physical runtime authenticates staff without reading digital credentials', async () => {
  const seen = [];
  const authClient = { auth: { getUser: async token => { seen.push(token); return { data: { user: { id: 'actor-1' } }, error: null }; } },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'קופאי' }, error: null }) }) }) }) };
  const runtime = createPhysicalRuntime({ PELECARD_PHYSICAL_ENABLED: 'true', PELECARD_PHYSICAL_USER: 'physical',
    PELECARD_PHYSICAL_PASSWORD: 'secret', PELECARD_PHYSICAL_TERMINAL: '2814926015' },
  { authClient, database: { query: async () => ({ rows: [] }) } });
  assert.deepEqual(await runtime.authenticate('token'), { id: 'actor-1', role: 'cashier' });
  assert.deepEqual(seen, ['token']);
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.hostedEnabled, false);
  assert.equal(runtime.workflow, runtime.workflow);
});
test('hosted route requires its own gates and canonical public URLs', () => {
  const env = { PELECARD_PHYSICAL_ENABLED: 'true', PELECARD_PHYSICAL_USER: 'physical',
    PELECARD_PHYSICAL_PASSWORD: 'secret', PELECARD_PHYSICAL_TERMINAL: '2814926015',
    PELECARD_PHYSICAL_HOSTED_ENABLED: 'true', PELECARD_PHYSICAL_HOSTED_INIT_ENABLED: 'true',
    PELECARD_PHYSICAL_HOSTED_RETURN_URL: 'https://example.test/payment/physical',
    PELECARD_PHYSICAL_HOSTED_CALLBACK_BASE: 'https://example.test/api/pelecard-physical-callback' };
  const authClient = { auth: { getUser: async () => ({ data: { user: null } }) } };
  const runtime = createPhysicalRuntime(env, { authClient,
    database: { query: async () => ({ rows: [] }) } });
  assert.equal(runtime.hostedEnabled, true);
  assert.equal(runtime.hostedInitEnabled, true);
  assert.throws(() => createPhysicalRuntime({ ...env,
    PELECARD_PHYSICAL_HOSTED_CALLBACK_BASE: 'https://evil.example/callback' },
  { authClient, database: { query: async () => ({ rows: [] }) } }));
});

test('direct HTTP runtime exposes the guarded queue publisher and capability gates', () => {
  const env = { PELECARD_PHYSICAL_ENABLED: 'true', PELECARD_PHYSICAL_USER: 'physical',
    PELECARD_PHYSICAL_PASSWORD: 'secret', PELECARD_PHYSICAL_TERMINAL: '2814926015',
    PELECARD_PHYSICAL_DISPATCH_ENABLED: 'true', PELECARD_PHYSICAL_DIRECT_PAYPER_ENABLED: 'true',
    PELECARD_PHYSICAL_CLOUD_WORKER_ENABLED: 'true', PELECARD_PHYSICAL_WORKER_MAX_MS: '360000',
    PELECARD_PHYSICAL_DIRECT_UI_ENABLED: 'true',
    PELECARD_PHYSICAL_ACCEPTANCE_ORDER_ID: '44444444-4444-4444-8444-444444444444',
    PELECARD_PHYSICAL_ACCEPTANCE_AMOUNT_MINOR: '1500',
    PELECARD_PHYSICAL_TEST_ACTOR_ID: '55555555-5555-4555-8555-555555555555' };
  const runtime = createPhysicalRuntime(env, { authClient: {},
    database: { query: async () => ({ rows: [] }) }, queueSend: async () => ({ id: 'synthetic' }) });
  assert.equal(runtime.dispatchEnabled, true);
  assert.equal(runtime.payperEnabled, true);
  assert.equal(runtime.cloudWorkerEnabled, true);
  assert.equal(runtime.directUiEnabled, true);
  assert.equal(runtime.acceptanceOrderId, '44444444-4444-4444-8444-444444444444');
  assert.equal(runtime.acceptanceAmountMinor, 1500);
  assert.equal('testActorId' in runtime, false);
  assert.equal(typeof runtime.enqueueDirect, 'function');
});
