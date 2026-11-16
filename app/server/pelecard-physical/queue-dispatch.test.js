import test from 'node:test';
import assert from 'node:assert/strict';
import { processDirectQueueMessage } from './queue-dispatch.js';

const id = '33333333-3333-4333-8333-333333333333';
test('immediate queue delivery dispatches one reserved intent and persists before verification', async () => {
  const calls = [];
  const runtime = { enabled: true, dispatchEnabled: true, payperEnabled: true, workerMaxMs: 360_000,
    repository: { status: async () => ({ id, route: 'direct', state: 'reserved', register: '004' }) },
    workflow: { dispatch: async value => { calls.push(['send-and-persist', value]); return { state: 'pending' }; },
      verify: async value => { calls.push(['verify', value]); return { state: 'succeeded' }; } } };
  assert.equal((await processDirectQueueMessage({ paymentId: id }, runtime)).state, 'succeeded');
  assert.deepEqual(calls, [['send-and-persist', id], ['verify', id]]);
});
test('redelivery and interrupted execution only reconcile an already claimed intent', async () => {
  const calls = [];
  const runtime = { enabled: true, dispatchEnabled: true, payperEnabled: true, workerMaxMs: 360_000,
    repository: { status: async () => ({ id, route: 'direct', state: 'uncertain', register: '004' }) },
    workflow: { dispatch: async () => { throw Error('second charge'); },
      verify: async value => { calls.push(value); return { state: 'uncertain' }; } } };
  await processDirectQueueMessage({ paymentId: id }, runtime);
  await processDirectQueueMessage({ paymentId: id }, runtime);
  assert.deepEqual(calls, [id, id]);
});
test('duplicate delivery during the terminal wait leaves the first response writer alone', async () => {
  const runtime = { enabled: true, dispatchEnabled: true, payperEnabled: true, workerMaxMs: 360_000,
    repository: { status: async () => ({ id, route: 'direct', state: 'dispatching', register: '004' }) },
    workflow: { dispatch: async () => { throw Error('second charge'); },
      verify: async () => { throw Error('premature reconciliation'); } } };
  assert.deepEqual(await processDirectQueueMessage({ paymentId: id }, runtime),
    { id, state: 'dispatching' });
});
test('queue rejects malformed or hosted messages without loading a financial workflow', async () => {
  const runtime = { enabled: true, dispatchEnabled: true, payperEnabled: true, workerMaxMs: 360_000,
    repository: { status: async () => ({ id, route: 'hosted', state: 'reserved' }) },
    workflow: { dispatch: async () => { throw Error('financial send'); } } };
  await assert.rejects(processDirectQueueMessage({ paymentId: 'bad' }, runtime));
  await assert.rejects(processDirectQueueMessage({ paymentId: id }, runtime));
  runtime.payperEnabled = false;
  await assert.rejects(processDirectQueueMessage({ paymentId: id }, runtime));
});
