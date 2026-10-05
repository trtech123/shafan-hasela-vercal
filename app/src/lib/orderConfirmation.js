export const canSendOrderConfirmation = role => ['admin','operations','cashier','אחמ"ש','קופאי'].includes(role);
export const validOrderEmail = value => typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(value);
export function normalizeOrderPhone(raw) {
 if(typeof raw!=='string'||raw.length<7||raw.length>40||/[\u0000-\u001f\u007f]/.test(raw)||!/^\+?[\d ()-]+$/.test(raw.trim()))return null;
 const digits=raw.replace(/\D/g,'');if(raw.trim().startsWith('+')&&digits.startsWith('0'))return null;
 const value=digits.startsWith('00972')?digits.slice(2):digits.startsWith('0')?'972'+digits.slice(1):digits;
 return value.startsWith('972') ? /^972(?:5\d{8}|[23489]\d{7}|7\d{8})$/.test(value)?value:null : /^[1-9]\d{8,14}$/.test(value)?value:null;
}
const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const customerFields = ['client_name','client_phone','client_email','organization','billing_institution_name','billing_company_id','billing_accounting_email','billing_address_line','billing_city','billing_postal_code','billing_country_code'];
export function orderConfirmationModel(order) {
  const quote = order.quotation_snapshot || {};
  const snapshot = order.customer_snapshot || {};
  const customer = Object.fromEntries(customerFields.map(key => [key, Object.hasOwn(snapshot,key) ? snapshot[key] : Object.hasOwn(order,key) ? order[key] : quote[key] ?? null]));
  const savedVat = Object.hasOwn(snapshot,'vat_applicable') ? snapshot.vat_applicable : Object.hasOwn(order,'vat_applicable') ? order.vat_applicable : quote.vat_applicable;
  const vat = typeof savedVat === 'boolean' ? savedVat : null;
  const vatLabel = vat === true ? 'חייב במע״מ — המחירים כוללים מע״מ' : vat === false ? 'מע״מ לא חל לפי ההחלטה השמורה להזמנה' : 'החלטת מע״מ היסטורית לא תועדה; לא הונח חיוב או פטור';
  const savedItems = Array.isArray(quote.selected_activities) ? quote.selected_activities : [];
  const items = savedItems.map(item => {
    const quantity = numeric(item.quantity ?? quote.num_participants);
    const unit = numeric(item.price_per_person);
    const total = numeric(item.line_total) ?? (quantity !== null && unit !== null ? Math.round(quantity * unit * 100) / 100 : null);
    return {name:item.activity_name || 'שם הפריט לא נשמר',type:item.item_type,quantity,unit,total,description:item.description || '',duration:numeric(item.duration_hours),site:item.site,date:item.activity_date || item.event_date};
  });
  const legacy = !savedItems.length;
  if (legacy) items.push({name:'פירוט פעילות/מוצר היסטורי לא נשמר',quantity:numeric(order.num_participants),unit:numeric(order.price_per_person),total:numeric(order.total_price),description:'מוצגים רק נתונים שנשמרו בהזמנה. פרטים לא הושלמו מהקטלוג הנוכחי.'});
  return {orderNumber:order.order_number || '—',customer,vat,vatLabel,items,legacy,total:numeric(order.total_price),discount:numeric(quote.discount),subtotal:numeric(quote.total_price),paymentStatus:order.payment_status || 'לא תועד',date:order.activity_date,start:order.start_time,end:order.end_time,site:order.site,participants:numeric(order.num_participants),savedAt:order.updated_at || order.created_at,notes:order.notes,quotationNotes:quote.notes && quote.notes !== order.notes ? quote.notes : null};
}
export { deliveryStateText as orderDeliveryStateText } from './deliveryStatus';
