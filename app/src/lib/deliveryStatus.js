// Provider acceptance is not recipient delivery. Never promote unknown history.
export const deliveryStateText = state => ({
 accepted:'השליחה התקבלה ✓',
 failed:'השליחה נכשלה. לא תתבצע שליחה חוזרת אוטומטית.',
 uncertain:'מצב השליחה לא ניתן לאימות כרגע. אין לשלוח שוב לפני בדיקה.',
 dispatched:'אישור השליחה טרם תועד. אין לשלוח שוב לפני בדיקה.',
}[state] || 'מצב השליחה דורש בדיקה. אין לשלוח שוב לפני בירור.');
export const deliveryStateClass = state => state === 'accepted' ? 'text-emerald-700 font-medium' : state === 'failed' ? 'text-red-700' : 'text-amber-800';
