/** Read-only startup check. No provider endpoint is called. */
export async function checkPhysicalWorkerReadiness(runtime) {
  if (runtime.enabled !== true) throw new Error('physical_disabled');
  const { rows } = await runtime.database.query('SELECT public.list_physical_worker_intents() AS result');
  if (rows?.length !== 1 || !Array.isArray(rows[0].result))
    throw new Error('physical_database_unavailable');
  const devices = await runtime.repository.listDevices();
  if (!Array.isArray(devices)) throw new Error('physical_devices_unavailable');
  const register004 = devices.some(row => row.registerNumber === '004' &&
    row.model === 'CT20' && typeof row.workstationCode === 'string' && row.workstationCode);
  return { ready: devices.length > 0, dispatchEnabled: runtime.dispatchEnabled === true,
    register004: Boolean(register004), assignedDevices: devices.length };
}
