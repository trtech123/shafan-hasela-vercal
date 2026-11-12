const reasons = {
  order_delete_forbidden: 'רק מנהל מורשה למחוק הזמנה.',
  order_delete_not_found: 'ההזמנה לא נמצאה. יש לרענן את הרשימה.',
  order_delete_payment_status: 'ההזמנה מסומנת כמשולמת או כתשלום בתהליך. יש לבדוק את מצב התשלום.',
  order_delete_financial_dependency: 'קיים תשלום, מכירה, שובר או מסמך חשבונאי הקשור להזמנה. אין למחוק אותה.',
  order_delete_quotation_link: 'ההזמנה קשורה להצעת מחיר שהומרה. יש לשמר את הקשר העסקי.',
  order_delete_instructor_commitment: 'להזמנה יש מדריך משויך או הודעה למדריך. יש לטפל בהתחייבות תחילה.',
  order_delete_scheduling_block: 'להזמנה יש חסימת זמן פעילה בלוח הזמנים. יש לטפל בה תחילה.',
  order_delete_confirmation_history: 'קיים אישור הזמנה, חתימה או היסטוריית שליחה שיש לשמר.',
  order_delete_customer_snapshot: 'קיימת תמונת לקוח או פרטי חיוב שנשמרו עם ההזמנה.',
  order_delete_status_not_eligible: 'אפשר למחוק רק הזמנה מבוטלת או הזמנה שממתינה לאישור, ללא התחייבויות.',
  order_delete_related_record: 'קיימות רשומות עסקיות נוספות הקשורות להזמנה. המחיקה נחסמה כדי לשמר אותן.',
  order_delete_confirmation_required: 'יש לאשר שאין התחייבות או אישור חיצוני שדורשים שימור.',
  order_delete_unconfirmed: 'מסד הנתונים לא אישר שההזמנה נמחקה. היא נשארה ברשימה.',
};

export function orderDeleteError(error) {
  const code = Object.keys(reasons).find(key => String(error?.message || '').includes(key));
  if (code) return reasons[code];
  if (error?.code === '23503') return reasons.order_delete_related_record;
  return 'מחיקת ההזמנה נכשלה. היא לא הוסרה מהרשימה; יש לבדוק את הפרטים ולנסות שוב רק לאחר בירור.';
}

export async function deleteOrder(client, orderId) {
  const { data, error } = await client.rpc('delete_order', {
    p_order_id: orderId,
    p_confirm_no_external_commitments: true,
  });
  if (error) throw error;
  if (data?.id !== orderId || data?.deleted !== true) throw new Error('order_delete_unconfirmed');
  return data;
}
