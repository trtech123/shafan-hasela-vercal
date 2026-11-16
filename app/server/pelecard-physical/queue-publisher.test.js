import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectQueuePublisher } from './queue-publisher.js';

test('publisher awaits an acknowledged idempotent message containing only payment ID', async () => {
  const calls = [];
  const publish = createDirectQueuePublisher(async (...args) => {
    calls.push(args); return { messageId: 'synthetic-message' };
  });
  const id = '33333333-3333-4333-8333-333333333333';
  assert.equal(await publish(id), 'synthetic-message');
  assert.deepEqual(calls, [['physical-j4-dispatch', { paymentId: id },
    { idempotencyKey: id, retentionSeconds: 86_400 }]]);
  await assert.rejects(publish('invalid'));
});
