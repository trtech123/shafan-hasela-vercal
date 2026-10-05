export function israelDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function validAttendanceRange(from, until) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(until)) return false;
  const days = (Date.parse(until) - Date.parse(from)) / 86400000;
  return days >= 0 && days <= 61;
}
export const attendanceLabels = { present: 'נוכח/ת', absent: 'נעדר/ת', excused: 'היעדרות מוצדקת' };
export const sessionLabels = { scheduled: 'מתוכנן', completed: 'התקיים', cancelled: 'מבוטל' };
export function attendanceError(error) {
  const message = String(error?.message || '');
  if (message.includes('conflict')) return 'הנתונים עודכנו במקביל. הרשימה נטענה מחדש; בדקו אותה לפני שמירה נוספת.';
  if (message.includes('invalid_date_range')) return 'יש לבחור עד 62 ימים. יצירת מפגשים אפשרית עד שנה לאחור ועד 90 ימים קדימה.';
  if (message.includes('overlapping_schedule_rules')) return 'קיימות הגדרות שבועיות כפולות לאותה שעה. יש לתקן את המערכת השבועית.';
  if (message.includes('ambiguous_membership_dates')) return 'למשתתף קיימות חברויות עם תאריכים חופפים. יש לבדוק את תאריכי החברות לפני פתיחת הרשימה.';
  if (message.includes('session_cancelled')) return 'המפגש בוטל ולא ניתן לשנות את הנוכחות בו.';
  if (message.includes('future_attendance')) return 'ניתן לסמן נוכחות רק במפגש של היום או של תאריך קודם.';
  if (message.includes('admin_required')) return 'אין הרשאה לפעולה זו.';
  return 'טעינת הנתונים נכשלה או שהשינוי לא אושר. רעננו את הרשימה לפני ניסיון נוסף.';
}
