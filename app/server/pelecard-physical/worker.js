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

export async function runPhysicalWorkerCycle({ database, workflow, workerMaxMs, dispatchEnabled }) {
  const { rows } = await database.query('SELECT public.list_physical_worker_intents() AS result');
  const pending = rows?.length === 1 && Array.isArray(rows[0].result) ? rows[0].result : [];
  return Promise.allSettled(pending.map(row => {
    if (row.state === 'reserved')
      return dispatchEnabled === true
        ? runPhysicalIntent({ workflow, intentId: row.paymentId, workerMaxMs })
        : Promise.resolve({ state: 'reserved' });
    return recoverPhysicalIntent({ workflow, intentId: row.paymentId });
  }));
}
