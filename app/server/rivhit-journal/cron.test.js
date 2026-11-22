import test from 'node:test';
import assert from 'node:assert/strict';
import { createRivhitJournalCron } from './cron.js';

const env = {
  CRON_SECRET: 'test-cron-secret', RIVHIT_JOURNAL_CRON_ENABLED: 'true',
  SUPABASE_URL: 'https://synthetic.supabase.co',
  SUPABASE_EDGE_SERVICE_ROLE_JWT: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.synthetic',
};
const request = authorization => new Request('https://example.invalid/api/rivhit-journal-cron', {
  headers: authorization ? { authorization } : {},
});

test('journal cron rejects unauthorized and disabled calls without contacting Edge', async () => {
  const fetchImpl = async () => { throw new Error('should not run'); };
  const handler = createRivhitJournalCron(env, fetchImpl);
  assert.equal((await handler(request())).status, 401);
  assert.equal((await createRivhitJournalCron({ ...env, RIVHIT_JOURNAL_CRON_ENABLED: 'false' }, fetchImpl)(
    request('Bearer test-cron-secret'))).status, 503);
});

test('journal cron calls only the private Edge batch with server credentials', async () => {
  let called = 0;
  const handler = createRivhitJournalCron(env, async (url, options) => {
    called++;
    assert.equal(String(url), 'https://synthetic.supabase.co/functions/v1/rivhit-journal-worker');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, `Bearer ${env.SUPABASE_EDGE_SERVICE_ROLE_JWT}`);
    assert.equal(options.body, JSON.stringify({ run: 'batch' }));
    return new Response(JSON.stringify({ staged: 1, processed: 0, reconciled: 0, blocked: 0 }), { status: 200 });
  });
  const response = await handler(request('Bearer test-cron-secret'));
  assert.equal(response.status, 200);
  assert.equal(called, 1);
  assert.deepEqual(await response.json(), { staged: 1, processed: 0, reconciled: 0, blocked: 0 });
});
