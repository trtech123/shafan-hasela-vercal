import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalCallbackHandler } from './callback.js';

const id = '11111111-1111-4111-8111-111111111111';
test('provider callback is only a notification; backend verifies hosted transaction independently', async () => {
  const calls = [];
  const handler = createPhysicalCallbackHandler({ hostedEnabled: true,
    repository: { status: async value => { calls.push(['status', value]);
      return { route: 'hosted', hostedTransactionId: 'hosted-1' }; } },
    workflow: { verify: async value => { calls.push(['verify', value]); return { state: 'succeeded' }; } } });
  const response = await handler(new Request(`https://example.test/api/pelecard-physical-callback?paymentId=${id}`,
    { method: 'POST', body: JSON.stringify({ PayperData: { InvoiceNumber: 'forged' } }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [['status', id], ['verify', id]]);
  assert.ok(!(await response.text()).includes('forged'));
});
test('callback rejects a non-hosted or unrecognized intent', async () => {
  const handler = createPhysicalCallbackHandler({ hostedEnabled: true,
    repository: { status: async () => ({ route: 'direct' }) }, workflow: { verify: async () => {
      throw Error('should not verify'); } } });
  assert.equal((await handler(new Request(`https://example.test/api/pelecard-physical-callback?paymentId=${id}`,
    { method: 'POST' }))).status, 404);
});
