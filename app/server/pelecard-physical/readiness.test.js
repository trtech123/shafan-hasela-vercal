import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPhysicalWorkerReadiness } from './readiness.js';

test('read-only preflight verifies database and register 004 without sending J4', async () => {
  const calls = [];
  const runtime = {
    enabled: true, dispatchEnabled: false, workerMaxMs: 0,
    database: { query: async sql => { calls.push(sql); return { rows: [{ result: [] }] }; } },
    repository: { listDevices: async () => [{ registerNumber: '004', workstationCode: 'FRONT', model: 'CT20', label: 'Front CT20' }] },
    workflow: { dispatch: () => { throw new Error('must not dispatch'); } },
  };
  assert.deepEqual(await checkPhysicalWorkerReadiness(runtime), {
    ready: true, dispatchEnabled: false, register004: true, assignedDevices: 1,
  });
  assert.deepEqual(calls, ['SELECT public.list_physical_worker_intents() AS result']);
});
test('preflight fails when CT20 is not enabled and assigned', async () => {
  const runtime = { enabled: true, dispatchEnabled: false,
    database: { query: async () => ({ rows: [{ result: [] }] }) },
    repository: { listDevices: async () => [] } };
  assert.deepEqual(await checkPhysicalWorkerReadiness(runtime), {
    ready: false, dispatchEnabled: false, register004: false, assignedDevices: 0,
  });
});
