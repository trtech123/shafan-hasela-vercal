// Run only in a durable worker process with more than five minutes available.
// Browser requests should reserve and return; they must not await this call.
export async function runPhysicalIntent({ workflow, intentId, workerMaxMs }) {
  if (!Number.isSafeInteger(workerMaxMs) || workerMaxMs < 330_000)
    throw new Error('physical_worker_duration_required');
  const dispatched = await workflow.dispatch(intentId);
  if (!['pending', 'uncertain'].includes(dispatched.state)) return dispatched;
  return workflow.verify(intentId);
}

export async function recoverPhysicalIntent({ workflow, intentId }) {
  // Recovery only reads the provider result. It never replays J4.
  return workflow.verify(intentId);
}
