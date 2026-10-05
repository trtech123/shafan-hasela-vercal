export const isOrderPaid = (status) => ['פלאקארד', 'שולם במלואו'].includes(status);
export const orderPaymentPath = (orderId) => `/payment/order?orderId=${encodeURIComponent(orderId)}`;
export const validOrderId = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');

export async function requestOrderPayment(client, body) {
  if (!validOrderId(body.orderId)) throw new Error('invalid_order');
  const startedAt = performance.now();
  const { data, error } = await client.functions.invoke('pelecard-order-payment', { body });
  if (error || !data || data.orderId !== body.orderId || !Number.isSafeInteger(data.amountMinor) || data.amountMinor < 0 || data.currency !== 'ILS' || data.mode !== 'live' || typeof data.paid !== 'boolean' || typeof data.canInitialize !== 'boolean') {
    throw new Error('payment_status_unavailable');
  }
  // Use server time and a monotonic local clock. Deduct the whole round trip
  // conservatively, so slow responses and browser clock changes cannot extend a session.
  const remaining = Date.parse(data.payment?.hostedExpiresAt) - Date.parse(data.serverTime);
  return { ...data, hostedDeadlineMs: Number.isFinite(remaining) ? startedAt + Math.max(0, remaining) : null };
}

export function redirectOrderPayment(url, location = window.location) {
  // The server returns only its validated persisted hosted URL.
  if (typeof url !== 'string' || !/^https:\/\/gateway20\.pelecard\.biz\/PaymentGW\?transactionId=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(url)) throw new Error('invalid_redirect');
  location.assign(url);
}
