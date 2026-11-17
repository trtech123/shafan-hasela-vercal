const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const register = /^(003|004|005|006)$/;
const states = new Set(['reserved', 'dispatching', 'pending', 'uncertain', 'approved', 'declined', 'canceled', 'succeeded']);
const hostedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validRedirect(value) {
  if (value == null) return true;
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ['gateway20.pelecard.biz', 'gateway21.pelecard.biz'].includes(url.hostname) &&
      url.pathname === '/PaymentGW' && !url.port && !url.username && !url.password &&
      !url.hash && [...url.searchParams.keys()].join(',') === 'transactionId' &&
      hostedId.test(url.searchParams.get('transactionId') ?? '');
  } catch { return false; }
}

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
  if (body.action === 'capability') {
    if (typeof result?.visible !== 'boolean' || typeof result?.ready !== 'boolean' ||
      typeof result?.registerReady !== 'boolean' ||
      !['direct', 'hosted'].includes(result.route) ||
      (result.ready && (!result.visible || !result.registerReady)))
      throw new Error('physical_status_unavailable');
    return result;
  }
  if (!uuid.test(result?.paymentId) || !states.has(result.state) ||
    !register.test(result.registerNumber) || !Number.isSafeInteger(result.amountMinor) ||
    result.amountMinor < 1 || (result.saleId !== null && !uuid.test(result.saleId)) ||
    !validRedirect(result.redirectUrl))
    throw new Error('physical_status_unavailable');
  return result;
}

export const getPhysicalAvailability = (client, fetcher = fetch, orderId = null) =>
  requestPhysicalPayment(client, orderId ? { action: 'capability', orderId } :
    { action: 'capability' }, fetcher);

// One cashier action performs the existing reservation and one-shot hosted
// initialization. The provider's own PINPAD button remains mandatory.
export async function startHostedPhysical(client, { requestKey, orderId = null,
  amountMinor = null, cart = null, billing = null, workstationCode = null,
  redirect = url => window.location.assign(url), fetcher = fetch }) {
  const devices = await requestPhysicalPayment(client, { action: 'devices' }, fetcher);
  const eligible = devices.filter(row => row.registerNumber === '004');
  const selected = workstationCode
    ? eligible.find(row => row.workstationCode === workstationCode)
    : eligible.length === 1 ? eligible[0] : null;
  if (!selected) throw new Error('physical_register_004_unavailable');
  const prepared = await requestPhysicalPayment(client, orderId
    ? { action: 'prepareOrder', requestKey, workstationCode: selected.workstationCode,
      orderId, amountMinor }
    : { action: 'prepare', requestKey, workstationCode: selected.workstationCode,
      cart, billing }, fetcher);
  if (prepared.registerNumber !== '004' ||
    (orderId && prepared.amountMinor !== amountMinor)) throw new Error('physical_amount_changed');
  const current = prepared.state === 'reserved' && prepared.hostedAvailable
    ? await requestPhysicalPayment(client, { action: 'openHosted', requestKey }, fetcher)
    : prepared;
  if (current.route === 'hosted' && current.state === 'pending' &&
    current.redirectUrl && validRedirect(current.redirectUrl)) redirect(current.redirectUrl);
  return current;
}

// Reserve the direct J4 intent and await a durable queue publish. The private
// cloud consumer owns financial dispatch; callers poll the same request key.
export async function startDirectPhysical(client, { requestKey, orderId = null,
  amountMinor = null, cart = null, billing = null, workstationCode = null,
  fetcher = fetch }) {
  const devices = await requestPhysicalPayment(client, { action: 'devices' }, fetcher);
  const eligible = devices.filter(row => row.registerNumber === '004');
  const selected = workstationCode
    ? eligible.find(row => row.workstationCode === workstationCode)
    : eligible.length === 1 ? eligible[0] : null;
  if (!selected) throw new Error('physical_register_004_unavailable');
  const prepared = await requestPhysicalPayment(client, orderId
    ? { action: 'prepareOrder', requestKey, workstationCode: selected.workstationCode,
      orderId, amountMinor }
    : { action: 'prepare', requestKey, workstationCode: selected.workstationCode,
      cart, billing }, fetcher);
  if (prepared.registerNumber !== '004' ||
    (orderId && prepared.amountMinor !== amountMinor)) throw new Error('physical_amount_changed');
  if (prepared.state !== 'reserved') return prepared;
  const queued = await requestPhysicalPayment(client,
    { action: 'enqueueDirect', requestKey }, fetcher);
  if (queued.paymentId !== prepared.paymentId ||
    queued.registerNumber !== prepared.registerNumber ||
    queued.amountMinor !== prepared.amountMinor) throw new Error('physical_intent_conflict');
  return queued;
}
