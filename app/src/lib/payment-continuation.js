const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Carry only payment locators across login, never arbitrary URLs or auth data.
export function safePaymentContinuation(value) {
  if (typeof value !== 'string' || !/^\/payment\/(order|return)(\?|$)/.test(value) || /[\\#\r\n]/.test(value)) return '/';
  const url = new URL(value, 'https://internal.invalid');
  const params = new URLSearchParams();
  for (const key of ['orderId', 'paymentId']) {
    const values = url.searchParams.getAll(key);
    if (values.length > 1 || (values.length && !uuid.test(values[0]))) return '/';
    if (values.length) params.set(key, values[0]);
  }
  if (url.pathname === '/payment/order' ? !params.has('orderId') : !params.has('orderId') && !params.has('paymentId')) return '/';
  if (url.searchParams.get('returned') === '1') params.set('returned', '1');
  return `${url.pathname}?${params}`;
}
