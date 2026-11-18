import { validSignature } from './signature.js';
export { emptySignature, validSignature } from './signature.js';
export function voucherDraftFromOrder(order = {}) {
  const service = order.service_description || order.activity_name || order.activities?.name || '';
  return { service_description: service ? [service, order.activity_date].filter(Boolean).join(' · ') : '',
    notes: order.notes || '', contact_name: order.client_name || '', phone: order.client_phone || '' };
}
export function voucherRegisterFromOrder(order, registers) {
  return registers.some((row) => row.code === order.register_code) ? order.register_code : '';
}
export function voucherMissingFields({order, register, draft, signature}) {
  const missing = [];
  if (!order.customer_snapshot_id) missing.push('אישור לקוח ופרטי חיוב להזמנה');
  if (!register) missing.push('בחירת קופה');
  if (!draft.service_description.trim() || draft.service_description.length > 2000) missing.push('תיאור השירות');
  if (!draft.contact_name.trim() || draft.contact_name.length > 300) missing.push('איש קשר');
  if (!/^[+\d ()-]{7,40}$/.test(draft.phone) || !/^\d{7,15}$/.test(draft.phone.replace(/\D/g, ''))) missing.push('טלפון תקין');
  if (draft.notes.length > 4000) missing.push('הערות עד 4,000 תווים');
  if (!validSignature(signature)) missing.push(signature?.strokes?.length ? 'חתימה תקינה — יש לנקות ולחתום מחדש בקווים קצרים יותר' : 'חתימה');
  return missing;
}
export function voucherError(error) {
  if (/order_voucher_exists/.test(error?.message || '')) return 'כבר קיים שובר חתום להזמנה. יש לפתוח אותו בשוברי הקפה; אין ליצור שובר נוסף.';
  if (/snapshot|version|stale/i.test(error?.message || '')) return 'פרטי ההזמנה השתנו. יש לרענן את ההזמנה ולבדוק שוב לפני חתימה.';
  if (/paid|payment/i.test(error?.message || '')) return 'ניתן ליצור שובר רק להזמנה שלא שולמה.';
  return 'תוצאת השמירה אינה ידועה. יש לבדוק אם השובר כבר נשמר. לא תישלח בקשת יצירה נוספת.';
}
