import { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { getUnlinkedPhysicalEvidence } from '@/payments/physical/client';

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'app.payper.co.il' &&
      !url.username && !url.password && !url.port && !url.hash &&
      /^\/public\/invoice_show\/[1-9][0-9]*$/.test(url.pathname) &&
      (!url.search || /^\?ak=[A-Za-z0-9_-]{16,128}$/.test(url.search)) ? url.href : null;
  } catch { return null; }
}

export default function PayperUnlinkedEvidence() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    getUnlinkedPhysicalEvidence(supabase).then(value => {
      if (active) setRows(value);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  return <section dir="rtl" aria-label="מסמכי Payper שטרם קושרו"
    className="rounded-2xl border border-amber-300 bg-amber-50 p-5 space-y-3">
    <h2 className="text-lg font-bold">מסמכי Payper שטרם קושרו</h2>
    <p className="text-sm">תשובת הספק מציינת שהמסמך הונפק. התשלום, המכירה והמסמך עדיין דורשים התאמה לפני הצגתם כרשומים.</p>
    {error ? <p role="alert">לא ניתן לטעון את ראיות המסמכים.</p> :
      rows.length === 0 ? <p>אין מסמכים ממתינים להתאמה.</p> :
        <ul className="space-y-2">{rows.map(row => <li key={row.paymentId}
          className="rounded-lg border border-amber-200 bg-white p-3 text-sm">
          <p>{row.orderNumber || 'מכירת קופה'} · מסמך {row.documentNumber} · {(row.amountMinor / 100).toFixed(2)} ₪</p>
          <p>עסקת Pelecard {row.providerTransactionId} · טרם קושר לתשלום ולמכירה</p>
          {row.orderId && <a className="ml-3 text-primary underline"
            href={`/cashregister?orderId=${encodeURIComponent(row.orderId)}`}>פתיחת ההזמנה</a>}
          {safeUrl(row.documentUrl) && <a className="text-primary underline"
            href={safeUrl(row.documentUrl)} target="_blank" rel="noopener noreferrer"
            referrerPolicy="no-referrer">צפייה במסמך ב־Payper והדפסה</a>}
        </li>)}</ul>}
  </section>;
}
