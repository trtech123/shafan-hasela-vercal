import { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';

function safePayperLink(value, documentNumber) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(documentNumber ?? '')) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    if (!['payper.co.il', 'app.payper.co.il'].includes(url.hostname)) return null;
    if (![
      `/public/invoice_show/${documentNumber}`,
      `/app/public/invoice_show/${documentNumber}`,
    ].includes(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

export default function PayperIssuedDocuments() {
  const [rows, setRows] = useState([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.from('payper_document_ledger')
          .select('payment_id,order_id,sale_id,document_number,document_url,provider_trx_record_id,updated_at')
          .eq('state', 'succeeded').order('updated_at', { ascending: false }).limit(100);
        if (!active) return;
        if (error) setUnavailable(true);
        else setRows(data ?? []);
      } catch { if (active) setUnavailable(true); }
    })();
    return () => { active = false; };
  }, []);

  return <section dir="rtl" aria-label="מסמכי Payper שהופקו" className="rounded-2xl border bg-card p-5 space-y-3">
    <h2 className="text-lg font-bold">מסמכי Payper שהופקו</h2>
    <p className="text-xs text-muted-foreground">קישור המסמך נגיש למנהל מורשה בלבד. יש לבדוק את תאריך ההפקה, הסכום והמע״מ לפני מסירה ללקוח. הצלחת ההפקה אינה אישור שהאימייל נמסר.</p>
    {unavailable ? <p role="alert">לא ניתן לטעון את מסמכי Payper.</p> : rows.length === 0
      ? <p>אין מסמכי Payper שהופקו.</p>
      : <ul className="space-y-2">{rows.map(row => {
        const url = safePayperLink(row.document_url, row.document_number);
        return <li key={row.payment_id} className="rounded-lg border p-3 text-sm">
          <span className="block">{row.order_id?`הזמנה: ${row.order_id}`:`מכירת קופה: ${row.sale_id}`} · מסמך: {row.document_number}</span>
          <span className="block">מזהה עסקת פלאקארד: {row.provider_trx_record_id}</span>
          {url ? <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
            className="text-primary underline">פתיחת מסמך Payper</a>
            : <span role="alert">קישור המסמך אינו תקין; נדרשת בדיקה ידנית.</span>}
        </li>;
      })}</ul>}
  </section>;
}
