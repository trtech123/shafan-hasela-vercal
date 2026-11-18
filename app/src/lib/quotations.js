export const canManageQuotations = role => ['admin', 'operations', 'אחמ"ש'].includes(role);
export const QUOTATION_FIELDS = ['client_name','client_phone','client_email','organization','event_date','site','num_participants','notes','status','selected_activities','discount','billing_institution_name','billing_company_id','billing_accounting_email','billing_address_line','billing_city','billing_postal_code','billing_country_code'];
const ITEM_FIELDS = ['item_type','activity_id','product_id','activity_name','price_per_person','quantity','description','image_url','images','duration_hours','site'];
export const quotationQuantity = (item, quote) => Number(item.quantity ?? quote.num_participants ?? 0);
export const quotationLineTotal = (item, quote) => item.line_total != null && Number.isFinite(Number(item.line_total))
  ? Number(item.line_total)
  : Math.round(Number(item.price_per_person || 0) * quotationQuantity(item, quote) * 100) / 100;
export const quotationVatLabel = value => value === true ? 'חייב במע״מ — המחירים כוללים מע״מ' : value === false ? 'לא חייב במע״מ' : 'מדיניות מע״מ לא נקבעה';
export function quotationTotals(quote) {
  const gross = Math.round((quote.selected_activities || []).reduce((sum, item) => sum + quotationLineTotal(item, quote), 0) * 100) / 100;
  const discount = Number(quote.discount || 0);
  return { gross, discount, final: Math.round((gross - discount) * 100) / 100 };
}
export function quotationPayload(source) {
  const data = Object.fromEntries(QUOTATION_FIELDS.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
  data.event_date = source.event_date || null; data.site = source.site || null;
  data.num_participants = source.num_participants == null || source.num_participants === '' ? null : Number(source.num_participants);
  data.discount = Number(source.discount || 0);
  data.selected_activities = (source.selected_activities || []).map(item => Object.fromEntries(ITEM_FIELDS.filter(key => item[key] !== undefined).map(key => [key, item[key]])));
  return data;
}
export function normalizeQuotationPhone(value) {
  if (typeof value !== 'string' || value.length < 7 || value.length > 40 || /[\x00-\x1f\x7f]/.test(value) || !/^\+?[\d ()-]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  const normalized = digits.startsWith('00972') ? digits.slice(2) : digits.startsWith('0') ? '972' + digits.slice(1) : digits;
  if (normalized.startsWith('972')) return /^972(?:5\d{8}|[23489]\d{7}|7\d{8})$/.test(normalized) ? normalized : null;
  return /^[1-9]\d{8,14}$/.test(normalized) ? normalized : null;
}
export const validQuotationEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export async function boundedQuotationOperation(operation, milliseconds = 20000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([operation(controller.signal), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('quotation_timeout'), { code: 'quotation_timeout' })); }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
export function quotationError(error) {
  const message = String(error?.message || '');
  if (/save_revision_required/.test(message)) return 'יש לפתוח את ההצעה ולשמור גרסה לפני המרה להזמנה.';
  if (/converted/.test(message)) return 'ההצעה כבר הומרה להזמנה ולא ניתן לערוך אותה.';
  if (/cancelled|canceled/.test(message)) return 'ההצעה בוטלה ולא ניתן להמיר אותה להזמנה.';
  if (/link_conflict/.test(message)) return 'כבר קיימת הזמנה מקושרת שאינה תואמת להצעה. יש לבדוק את הקישור לפני המשך.';
  if (/conversion_fields_required/.test(message)) return 'יש להשלים תאריך אירוע, שם לקוח, טלפון וכמות תקינה ולשמור את ההצעה לפני המרה.';
  if (error?.code === 'PT409' || /version|stale|conflict/.test(message)) return 'ההצעה או כרטיס הלקוח השתנו. רעננו את הנתונים לפני שמירה; השינויים שלכם נשארו בטופס.';
  if (error?.code === '42501') return 'אין הרשאה לבצע את הפעולה.';
  if (/date/.test(message)) return 'יש למלא תאריך אירוע לפני ההמרה.';
  if (/quantity|item|price|discount|invalid/.test(message)) return 'בדקו את הפריטים, הכמויות, המחירים וההנחה בהצעה.';
  return 'לא ניתן להשלים את הפעולה כרגע. הפרטים נשמרו בטופס.';
}
