import { handleCallback } from '@vercel/queue';
import { createPhysicalRuntime } from '../server/pelecard-physical/runtime.js';
import { processDirectQueueMessage } from '../server/pelecard-physical/queue-dispatch.js';

// Vercel's queue trigger is private. The callback acknowledges only after
// the worker has finished; redelivery is safe because dispatch is claimed once.
export default {
  fetch: handleCallback(async message => {
    if (process.env.PELECARD_PHYSICAL_CLOUD_WORKER_ENABLED !== 'true')
      throw new Error('physical_cloud_worker_disabled');
    await processDirectQueueMessage(message, createPhysicalRuntime(process.env));
  }),
};
