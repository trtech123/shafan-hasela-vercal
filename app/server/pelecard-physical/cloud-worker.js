import { runPhysicalWorkerCycle } from './worker.js';

export function createCloudPhysicalWorkerHandler(env, loadRuntime, log = console.info) {
  return async request => {
    if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    if (!env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`)
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (env.PELECARD_PHYSICAL_CLOUD_WORKER_ENABLED !== 'true')
      return Response.json({ error: 'physical_cloud_worker_disabled' }, { status: 503 });
    try {
      const runtime = loadRuntime();
      if (!runtime.enabled || runtime.workerMaxMs < 330_000)
        return Response.json({ error: 'physical_worker_duration_required' }, { status: 503 });
      // Scheduled invocations reconcile only. An acknowledged queue publish
      // owns prompt checkout dispatch; cron must not surprise a cashier later.
      const results = await runPhysicalWorkerCycle({ ...runtime, dispatchEnabled: false });
      const failed = results.filter(item => item.status === 'rejected').length;
      const unresolved = results.filter(item => item.status === 'fulfilled' &&
        ['pending', 'uncertain', 'approved', 'reserved'].includes(item.value?.state)).length;
      const summary = { processed: results.length, failed, unresolved };
      log('physical_worker_health', summary);
      return Response.json(summary, { status: failed ? 503 : 200,
        headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return Response.json({ error: 'physical_worker_unavailable' }, { status: 503,
        headers: { 'Cache-Control': 'no-store' } });
    }
  };
}
