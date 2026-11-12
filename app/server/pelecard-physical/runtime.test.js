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
  assert.equal(runtime.workflow, runtime.workflow);
});
