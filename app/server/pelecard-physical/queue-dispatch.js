import { runPhysicalIntent, recoverPhysicalIntent } from './worker.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function processDirectQueueMessage(message, runtime) {
  const paymentId = message?.paymentId;
  if (!uuid.test(paymentId ?? '') || !runtime.enabled || !runtime.dispatchEnabled ||
    !runtime.payperEnabled ||
    !Number.isSafeInteger(runtime.workerMaxMs) || runtime.workerMaxMs < 330_000)
    throw new Error('physical_queue_unavailable');
  const intent = await runtime.repository.status(paymentId);
  if (!intent || intent.route !== 'direct' || intent.register !== '004')
    throw new Error('physical_queue_intent_invalid');
  if (intent.state === 'reserved')
    return runPhysicalIntent({ workflow: runtime.workflow, intentId: paymentId,
      workerMaxMs: runtime.workerMaxMs });
  // A duplicate delivery can arrive while the first J4 call still waits on
  // the terminal. Leave it alone; cron reconciles stale dispatching attempts.
  if (intent.state === 'dispatching') return { id: paymentId, state: 'dispatching' };
  if (['pending', 'uncertain', 'approved'].includes(intent.state))
    return recoverPhysicalIntent({ workflow: runtime.workflow, intentId: paymentId });
  return { id: paymentId, state: intent.state };
}
