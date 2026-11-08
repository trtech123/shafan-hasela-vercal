const messages = {
  order_archive_forbidden: 'רק מנהל מערכת רשאי לארכב או לשחזר הזמנות.',
  order_archive_financial_dependency: 'לא ניתן לארכב הזמנה עם תשלום, מסמך כספי או רישום כספי מקושר. יש להשאיר אותה ברשימה הפעילה עד להחלטת מדיניות.',
  order_archive_status_not_eligible: 'אפשר לארכב הזמנה שבוטלה או הזמנה שעדיין ממתינה לאישור. הזמנה מאושרת דורשת טיפול נפרד.',
  order_archive_quotation_link: 'ההזמנה מקושרת להמרת הצעת מחיר. יש להסדיר את הקשר להצעה לפני ארכוב.',
  order_archive_instructor_commitment: 'יש להזמנה מדריך משויך או הודעה שנשלחה למדריך. יש להסדיר את השיבוץ לפני ארכוב.',
  order_archive_scheduling_block: 'יש להזמנה חסימת שעות מקושרת. יש להסדיר את החסימה לפני ארכוב.',
  order_archive_confirmation_required: 'יש לאשר במפורש שאין אישור ללקוח או התחייבות חיצונית פתוחה.',
  order_archive_business_update_forbidden: 'לא ניתן לערוך הזמנה מאורכבת. יש לשחזר אותה תחילה.',
  order_restore_schedule_review_required: 'לשחזור הזמנה עתידית נדרשים אתר ושעות מלאות כדי לבדוק התנגשויות.',
  order_restore_schedule_conflict: 'לא ניתן לשחזר את ההזמנה: הזמן או האתר תפוסים כעת. יש להסדיר את השיבוץ תחילה.',
  order_archive_not_found: 'ההזמנה לא נמצאה או שאין הרשאה לצפות בה.',
  order_archive_already_archived: 'ההזמנה כבר נמצאת בארכיון. יש לרענן את הרשימה.',
  order_archive_not_archived: 'ההזמנה כבר נמצאת ברשימה הפעילה. יש לרענן את הרשימה.',
  order_archive_invalid_id: 'מזהה ההזמנה אינו תקין.',
  order_archive_invalid_transition: 'מעבר מצב הארכוב אינו תקין.',
};

export function orderArchiveError(error) {
  const detail = error?.message || 'שגיאה לא ידועה במסד הנתונים';
  return messages[detail] ? `${messages[detail]} (${detail})` : `הפעולה נכשלה: ${detail}`;
}
