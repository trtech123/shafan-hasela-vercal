import { handleCallback } from '@vercel/queue';
import { runPhysicalQueueSmoke } from '../server/pelecard-physical/queue-smoke.js';

// Private, provider-free deployment probe. This module imports no credentials,
// database, payment workflow or Pelecard transport.
export default {
  fetch: handleCallback(async message => {
    const result = await runPhysicalQueueSmoke(message, process.env);
    console.info('physical_j4_queue_smoke_complete', result.delayMs);
  }),
};
