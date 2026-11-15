import { createPhysicalRuntime } from '../server/pelecard-physical/runtime.js';
import { createPhysicalCallbackHandler } from '../server/pelecard-physical/callback.js';

export default {
  async fetch(request) {
    try {
      return await createPhysicalCallbackHandler(createPhysicalRuntime(process.env))(request);
    } catch { return new Response(null, { status: 503,
      headers: { 'Cache-Control': 'no-store' } }); }
  },
};
