import { validOrderId } from '@/payments/orderPayments';

export const IMMEDIATE_ORDER_COLUMNS = 'id,order_number,total_price,payment_status,client_name,organization,billing_institution_name,billing_company_id,billing_accounting_email,client_email,client_phone,customer_id,customer_snapshot_id,customer_record_version,vat_applicable';
export function billingFromOrder(order) {
  return { name: order.billing_institution_name || order.organization || order.client_name || '', companyId: order.billing_company_id || '', email: order.billing_accounting_email || order.client_email || '', phone: order.client_phone || '', customerId: order.customer_id || null, customerSnapshotId: order.customer_snapshot_id || null, vatApplicable: typeof order.vat_applicable === 'boolean' ? order.vat_applicable : null };
}
export function billingReady(billing) {
  const companyId = billing?.companyId || '';
  const validCompany = !companyId || /^\d{9}$/.test(companyId) && !/^0+$/.test(companyId) && [...companyId].reduce((sum, digit, index) => { const n = Number(digit) * (index % 2 + 1); return sum + (n > 9 ? n - 9 : n); }, 0) % 10 === 0;
  const phone = billing?.phone || '';
  return Boolean(billing?.name?.trim() && billing.name.trim().length <= 30 && validCompany && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing?.email || '') && billing.email.length <= 50 && /^[+\d ()-]{7,15}$/.test(phone) && /^\d{7,15}$/.test(phone.replace(/\D/g, '')));
}
export function documentLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname === 'rivhit.co.il' || url.hostname.endsWith('.rivhit.co.il')) ? url.href : null;
  } catch { return null; }
}
export async function requestImmediateAccounting(client, action, orderId, confirmations = {}) {
  if (!validOrderId(orderId) || !['status', 'prepare', 'reconcile'].includes(action)) throw new Error('invalid_request');
  const { data, error } = await client.functions.invoke('rivhit-immediate-accounting', { body: { action, orderId, ...(action === 'prepare' ? { billingConfirmed: confirmations.billingConfirmed === true, noPriorInvoice: confirmations.noPriorInvoice === true, billingReviewHash: confirmations.billingReviewHash } : {}) } });
  if (error || !data || data.ok === false || data.order?.id !== orderId) throw new Error('accounting_unavailable');
  return data;
}
// Preserve both the key and original request after an uncertain response.
export function checkDetailsReady(details) {
  if (!details || Object.keys(details).length !== 5 || !/^[1-9]\d{0,2}$/.test(details.bankCode || '') || !/^[1-9]\d{0,3}$/.test(details.branchNumber || '') || !/^\d{1,20}$/.test(details.accountNumber || '') || !/^[1-9]\d{0,8}$/.test(details.checkNumber || '') || !/^\d{4}-\d{2}-\d{2}$/.test(details.dueDate || '')) return false;
  const date = new Date(details.dueDate);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === details.dueDate;
}
export function definitiveManualValidationError(error) {
  return error?.code === 'P0001' && ['invalid_check_details', 'invalid_cash_details'].includes(error?.message);
}
export function clearRejectedManualIntent(storage, orderId, intentId, error, status) {
  if (!definitiveManualValidationError(error) || status?.order?.id !== orderId || status.canRecordManualPayment !== true || status.manualPayment || status.preparation || status.payment?.status === 'succeeded') return false;
  const key = `immediate-manual-payment:${orderId}`;
  const saved = storage.getItem(key);
  if (!saved || JSON.parse(saved).id !== intentId) return false;
  storage.removeItem(key);
  return true;
}
export function manualPaymentIntent(storage, orderId, method, details, uuid = () => crypto.randomUUID()) {
  if (!validOrderId(orderId) || !['cash', 'check'].includes(method)) throw new Error('invalid_payment');
  if (method === 'check' && !checkDetailsReady(details)) throw new Error('invalid_check_details');
  const key = `immediate-manual-payment:${orderId}`;
  const fingerprint = JSON.stringify({ method, details });
  const existing = storage.getItem(key);
  if (existing) {
    const intent = JSON.parse(existing);
    if (intent.fingerprint !== fingerprint || !validOrderId(intent.id)) throw new Error('payment_intent_changed');
    return intent.id;
  }
  const id = uuid();
  storage.setItem(key, JSON.stringify({ id, fingerprint }));
  return id;
}
export const ACCOUNTING_LABELS = { held: 'מושהה — ממתין לאישור הפקה', ready: 'ממתין', pending: 'ממתין', processing: 'בטיפול', dispatching: 'בטיפול', succeeded: 'הושלם', failed: 'נכשל', requires_attention: 'דורש בדיקה', mapping_required: 'נדרש מיפוי פרטי תשלום', artifact_required: 'המסמך קיים — קישור דורש בדיקה', reconciliation_required: 'דורש בדיקה', retryable_error: 'נכשל', permanent_error: 'נכשל' };
