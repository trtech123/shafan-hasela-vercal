import test from 'node:test';
import assert from 'node:assert/strict';
import { runPhysicalQueueSmoke } from './queue-smoke.js';

test('smoke consumer requires explicit gate and accepts only synthetic marker', async () => {
  await assert.rejects(runPhysicalQueueSmoke({ marker: 'synthetic-j4-smoke', delayMs: 0 }, {}));
  await assert.rejects(runPhysicalQueueSmoke({ paymentId: '33333333-3333-4333-8333-333333333333' },
    { PELECARD_PHYSICAL_QUEUE_SMOKE_ENABLED: 'true' }));
  assert.deepEqual(await runPhysicalQueueSmoke({ marker: 'synthetic-j4-smoke', delayMs: 0 },
    { PELECARD_PHYSICAL_QUEUE_SMOKE_ENABLED: 'true' }), { marker: 'synthetic-j4-smoke', delayMs: 0 });
});
