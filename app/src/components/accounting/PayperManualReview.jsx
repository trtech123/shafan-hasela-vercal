import { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';

const reasons = {
  billing_snapshot_required: 'חסרה תמונת פרטי חיוב מאומתת',
  billing_identity_required: 'נדרש בירור זהות לחיוב',
  billing_email_required: 'נדרש בירור כתובת דוא״ל לחיוב',
  service_description_required: 'נדרש בירור תיאור השירות בחשבונית',
  vat_treatment_required: 'נדרש בירור סיווג מע״מ',
  pre_dispatch_review_required: 'נדרשת בדיקה לפני הפקת מסמך',
  provider_credentials_rejected: 'הספק דחה את פרטי הגישה להפקת המסמך; יש לבדוק אם נוצר מסמך',
  provider_ip_rejected: 'הספק דחה את בקשת ההפקה; יש לבדוק אם נוצר מסמך',
  provider_document_rejected: 'הספק לא אישר את הפקת המסמך; יש לבדוק אם נוצר מסמך',
  provider_http_error: 'בקשת ההפקה נכשלה; מצב המסמך אינו ודאי',
  provider_transport_uncertain: 'לא התקבלה תשובה ודאית מהספק; אין לנסות שוב אוטומטית',
  provider_response_uncertain: 'תשובת הספק אינה ודאית; אין לנסות שוב אוטומטית',
  uncertain_provider_outcome: 'תוצאת הפקת המסמך אינה ודאית; אין לנסות שוב אוטומטית',
};

export default function PayperManualReview() {
  const [rows, setRows] = useState([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.from('payper_document_ledger')
          .select('payment_id,order_id,sale_id,state,reconciliation_code,created_at')
          .in('state', ['source_blocked', 'reconciliation_required'])
          .order('created_at', { ascending: false }).limit(100);
        if (!active) return;
        if (error) setUnavailable(true);
        else setRows(data ?? []);
      } catch { if (active) setUnavailable(true); }
    })();
    return () => { active = false; };
  }, []);
  if (unavailable) return <section dir="rtl" role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
    לא ניתן לטעון את רשימת הבדיקה הידנית של Payper. יש לבדוק את מצב המסמכים לפני כל הפקה.
  </section>;
  return <section dir="rtl" aria-label="בדיקה ידנית למסמכי Payper" className="rounded-2xl border bg-card p-5 space-y-3">
    <h2 className="text-lg font-bold">בדיקה ידנית למסמכי Payper</h2>
    <p className="text-xs text-muted-foreground">מוצגות עד 100 הרשומות האחרונות. הרשימה המלאה שמורה ביומן Payper.</p>
    {rows.length > 0 && <p role="alert" className="rounded-lg bg-amber-100 p-3 text-sm text-amber-950">הודעה למנהל: יש תשלומים שמחייבים טיפול במסמך החשבונאי. מזהי המקור והתשלום מופיעים למטה. לאחר תוצאה לא ודאית אין לנסות הפקה חוזרת; ניסיון חדש מחייב אישור מוסמך שלא נוצר מסמך קודם.</p>}
    {rows.length === 0 ? <p className="text-sm text-muted-foreground">אין תשלומים שממתינים לבדיקה ידנית.</p>
      : <ul className="space-y-2">{rows.map(row => <li key={row.payment_id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
        <strong>{reasons[row.reconciliation_code] ?? 'נדרשת התאמה ידנית'}</strong>
        <span className="block font-mono text-xs">תשלום: {row.payment_id} · {row.order_id?`הזמנה: ${row.order_id}`:`מכירת קופה: ${row.sale_id}`}</span>
        <span className="block text-xs">התשלום נשמר. אין להפיק מסמך חוזר אוטומטית או דרך Rivhit.</span>
      </li>)}</ul>}
  </section>;
}
