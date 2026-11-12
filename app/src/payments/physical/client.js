const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const register = /^(003|004|005|006)$/;
const states = new Set(['reserved', 'dispatching', 'pending', 'uncertain', 'approved', 'declined', 'canceled', 'succeeded']);

export async function requestPhysicalPayment(client, body, fetcher = fetch) {
  const { data: { session } = {} } = await client.auth.getSession();
  if (!session?.access_token) throw new Error('physical_auth_required');
  const response = await fetcher('/api/pelecard-physical', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body), credentials: 'same-origin' });
  if (!response.ok) throw new Error('physical_status_unavailable');
  const result = await response.json();
  if (body.action === 'devices') {
    if (!Array.isArray(result) || result.some(row => !register.test(row?.registerNumber) ||
      typeof row.workstationCode !== 'string' || typeof row.label !== 'string' ||
      !['N86', 'CT20'].includes(row.model))) throw new Error('physical_status_unavailable');
    return result;
  }
  if (!uuid.test(result?.paymentId) || !states.has(result.state) ||
    !register.test(result.registerNumber) || !Number.isSafeInteger(result.amountMinor) ||
    result.amountMinor < 1 || (result.saleId !== null && !uuid.test(result.saleId)))
    throw new Error('physical_status_unavailable');
  return result;
}
