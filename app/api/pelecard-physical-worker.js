import { createPhysicalRuntime } from '../server/pelecard-physical/runtime.js';
import { createCloudPhysicalWorkerHandler } from '../server/pelecard-physical/cloud-worker.js';

export default {
  fetch: createCloudPhysicalWorkerHandler(process.env, () => createPhysicalRuntime(process.env)),
};
