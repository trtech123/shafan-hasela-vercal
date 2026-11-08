import { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';

export default function PayperDispatchStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const { data: control, error } = await supabase.from('payper_dispatch_control')
        .select('enabled,dispatch_mode,canary_payment_id,dispatch_remaining').eq('singleton', true).single();
      if (!active) return;
      if (error || !control) { setStatus({ kind: 'unknown' }); return; }
      if (control.dispatch_mode === 'canary' && control.canary_payment_id) {
        const { data: payment, error: paymentError } = await supabase.from('payment_transactions')
          .select('status').eq('id', control.canary_payment_id).single();
        if (!active) return;
        if (paymentError || !payment) { setStatus({ kind: 'unknown' }); return; }
        if (payment.status === 'failed' || payment.status === 'cancelled') {
          setStatus({ kind: 'stale', paymentId: control.canary_payment_id }); return;
        }
      }
      if (!control.enabled) { setStatus({ kind: 'off' }); return; }
      if (control.dispatch_mode === 'continuous' && !control.canary_payment_id && control.dispatch_remaining === 0) {
        setStatus({ kind: 'continuous' }); return;
      }
      if (control.dispatch_mode !== 'canary' || !control.canary_payment_id) {
        setStatus({ kind: 'invalid' }); return;
      }
      setStatus({ kind: 'canary', paymentId: control.canary_payment_id });
    }
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  if (!status) return null;
  const message = {
    unknown: 'לא ניתן לאמת את מצב הפעלת Payper. בדקו את בקרת ההפצה לפני הסתמכות על הפקה אוטומטית.',
    off: 'הפקת חשבוניות Payper אוטומטית כבויה.',
    invalid: 'הגדרת הפצת Payper אינה שלמה. תשלומים חדשים עלולים להישאר ללא חשבונית.',
    stale: 'Payper מכוון לתשלום שבוטל. תשלומים חדשים אינם נשלחים להפקת חשבונית; נדרשת בדיקת מנהל.',
    canary: 'Payper פועל במצב בדיקה לתשלום אחד בלבד. רכישות אחרות אינן נשלחות להפקה אוטומטית.',
    continuous: 'Payper מוגדר במצב הפצה רציף. יש לעקוב אחר תוצאות הספק והחריגות להלן.',
  }[status.kind];
  return <section dir="rtl" role="status" aria-label="מצב הפצת Payper"
    className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
    {message}
    {status.paymentId && <span className="block font-mono text-xs">תשלום יעד: {status.paymentId}</span>}
  </section>;
}
