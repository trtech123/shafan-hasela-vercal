import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalDatabase } from './database.js';

test('physical database connection uses dedicated secrets and service-role RPC context', async () => {
  const calls = [];
  class Client {
    constructor(options) { calls.push(['options', options]); }
    async connect() { calls.push(['connect']); }
    async query(sql, args) { calls.push(['query', sql, args]); return { rows: [{ result: true }] }; }
    async end() { calls.push(['end']); }
  }
  const db = createPhysicalDatabase({
    PELECARD_PHYSICAL_DATABASE_URL: 'postgresql://physical:pass@db.example.com:5432/postgres',
    PELECARD_PHYSICAL_DATABASE_CA: '-----BEGIN CERTIFICATE-----\nlocal-test\n-----END CERTIFICATE-----',
  }, Client);
  assert.deepEqual(await db.query('SELECT public.claim_physical_dispatch($1::uuid) AS result', ['id']), { rows: [{ result: true }] });
  assert.equal(calls[0][1].ssl.rejectUnauthorized, true);
  assert.deepEqual(calls.slice(1).map(item => item[0]), ['connect', 'query', 'query', 'query', 'query', 'end']);
  assert.match(calls[3][1], /request\.jwt\.claim\.role/);
  assert.equal(calls[4][1], 'SELECT public.claim_physical_dispatch($1::uuid) AS result');
});
test('physical database cannot fall back to digital database settings', () => {
  assert.throws(() => createPhysicalDatabase({ PELECARD_LIVE_ADAPTER_DATABASE_URL: 'postgresql://x:y@db.example.com/postgres' }),
    /physical_database_configuration_required/);
});
