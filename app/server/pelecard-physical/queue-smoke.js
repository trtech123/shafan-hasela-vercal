export async function runPhysicalQueueSmoke(message, env) {
  if (env.PELECARD_PHYSICAL_QUEUE_SMOKE_ENABLED !== 'true' ||
    message?.marker !== 'synthetic-j4-smoke' ||
    !Number.isSafeInteger(message.delayMs) || message.delayMs < 0 ||
    message.delayMs > 310_000 || Object.keys(message).sort().join(',') !== 'delayMs,marker')
    throw new Error('physical_queue_smoke_disabled');
  await new Promise(resolve => setTimeout(resolve, message.delayMs));
  return { marker: message.marker, delayMs: message.delayMs };
}
