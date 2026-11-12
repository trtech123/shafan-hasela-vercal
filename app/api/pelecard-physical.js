import { createPhysicalRuntime } from '../server/pelecard-physical/runtime.js';
import { createPhysicalHttpHandler } from '../server/pelecard-physical/http.js';

export default {
  async fetch(request) {
    try {
      return await createPhysicalHttpHandler(createPhysicalRuntime(process.env))(request);
    } catch {
      return Response.json({ error: 'physical_configuration_unavailable' }, { status: 503,
        headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
