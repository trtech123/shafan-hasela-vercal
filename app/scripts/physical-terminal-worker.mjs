import { createPhysicalRuntime } from '../server/pelecard-physical/runtime.js';
import { runPhysicalWorkerCycle } from '../server/pelecard-physical/worker.js';
import { checkPhysicalWorkerReadiness } from '../server/pelecard-physical/readiness.js';

// Run as a dedicated long-lived Node process. No browser or Vercel request
// waits for J4. The financial send is impossible unless both physical gates
// are explicitly enabled in this process's environment.
const runtime = createPhysicalRuntime(process.env);
if (!runtime.enabled) throw new Error('physical_disabled');
if (runtime.dispatchEnabled && runtime.workerMaxMs < 330_000)
  throw new Error('physical_worker_duration_required');
const readiness = await checkPhysicalWorkerReadiness(runtime);
if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ event: 'physical_worker_readiness', ...readiness }));
  process.exit(readiness.ready ? 0 : 1);
}
if (!readiness.ready) throw new Error('physical_devices_unavailable');
console.log(JSON.stringify({ event: 'physical_worker_started', dispatchEnabled: runtime.dispatchEnabled,
  assignedDevices: readiness.assignedDevices }));

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
while (!stopping) {
  try {
    const results = await runPhysicalWorkerCycle(runtime);
    const failures = results.filter(result => result.status === 'rejected').length;
    if (failures) console.error(JSON.stringify({ event: 'physical_worker_cycle', failures }));
  } catch {
    console.error(JSON.stringify({ event: 'physical_worker_cycle', failures: 1 }));
  }
  if (!stopping) await new Promise(resolve => setTimeout(resolve, 15_000));
}
