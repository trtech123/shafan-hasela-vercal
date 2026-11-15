import { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';

const labels = {
  source_frozen: 'ממתין להפקה', source_blocked: 'נדרשת בדיקה לפני הפקה',
  dispatch_reserved: 'בקשת הפקה נשלחה; יש לבדוק תוצאה',
  reconciliation_required: 'נדרשת התאמה מול Payper',
};

export default function PayperNoncardObligations() {
  const [rows, setRows] = useState([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { data, error } = await supabase.from('payper_document_ledger')
          .select('payment_id,order_id,sale_id,state,reconciliation_code,source_facts,created_at')
          .in('state', Object.keys(labels)).order('created_at', { ascending: false }).limit(100);
        if (!active) return;
        if (error) setUnavailable(true);
        else { setRows((data || []).filter(row => ['manual_check', 'manual_cash'].includes(row.source_facts?.sourceType))); setUnavailable(false); }
      } catch { if (active) setUnavailable(true); }
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  if (unavailable) return <section role="alert" dir="rtl">לא ניתן לטעון התחייבויות Payper לתשלומי המחאה ומזומן.</section>;
  return <section dir="rtl" className="rounded-2xl border bg-card p-5 space-y-3">
    <h2 className="text-lg font-bold">מסמכי Payper ממתינים: המחאות ומזומן</h2>
    {rows.length === 0 ? <p className="text-sm text-muted-foreground">אין התחייבויות ממתינות.</p>
      : <ul className="space-y-2">{rows.map(row => <li key={row.payment_id} className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
        <strong>{labels[row.state]}</strong>
        <span className="block">{row.source_facts?.sourceType === 'manual_check' ? 'המחאה' : 'מזומן'} · {row.order_id ? `הזמנה ${row.order_id}` : `מכירה ${row.sale_id}`}</span>
        <span className="block font-mono text-xs">תשלום: {row.payment_id}</span>
        {row.reconciliation_code && <span className="block text-xs">קוד בדיקה: {row.reconciliation_code}</span>}
      </li>)}</ul>}
  </section>;
}
