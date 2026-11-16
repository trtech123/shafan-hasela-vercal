import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudPhysicalWorkerHandler } from './cloud-worker.js';

test('cloud worker rejects unauthenticated and disabled requests before loading credentials', async () => {
  let loaded = false;
  const handler = createCloudPhysicalWorkerHandler({ CRON_SECRET: 'synthetic-secret',
    PELECARD_PHYSICAL_CLOUD_WORKER_ENABLED: 'false' }, () => { loaded = true; });
  const request = new Request('https://example.test/api/pelecard-physical-worker');
  assert.equal((await handler(request)).status, 401);
  assert.equal((await handler(new Request(request, { headers: {
    authorization: 'Bearer synthetic-secret' } }))).status, 503);
  assert.equal(loaded, false);
});

test('cloud worker reports failed recovery without retrying a financial send', async () => {
  const runtime = { enabled: true, dispatchEnabled: false, workerMaxMs: 360_000,
    database: { query: async () => ({ rows: [{ result: [{ paymentId: 'synthetic-1', state: 'uncertain' }] }] }) },
    workflow: { verify: async () => { throw Error('lookup unavailable'); },
      dispatch: async () => { throw Error('must not send'); } } };
  const handler = createCloudPhysicalWorkerHandler({ CRON_SECRET: 'synthetic-secret',
    PELECARD_PHYSICAL_CLOUD_WORKER_ENABLED: 'true' }, () => runtime);
  const response = await handler(new Request('https://example.test/api/pelecard-physical-worker',
    { headers: { authorization: 'Bearer synthetic-secret' } }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { processed: 1, failed: 1, unresolved: 0 });
});
