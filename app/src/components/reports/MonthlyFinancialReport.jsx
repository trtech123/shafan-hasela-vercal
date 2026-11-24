import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { ACCOUNTING_SITES } from '@/payments/accountingSite';
import { monthlyReportCsv, summarizeMonthlyPayments } from '@/reports/monthlyFinancial';

const money = agorot => new Intl.NumberFormat('he-IL', {
  style: 'currency', currency: 'ILS', minimumFractionDigits: 2,
}).format(agorot / 100);
const registers = ['003', '004', '005', '006'];

export default function MonthlyFinancialReport() {
  const { user } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [site, setSite] = useState('');
  const [register, setRegister] = useState('all');
  const [rows, setRows] = useState([]);
  const [payers, setPayers] = useState(null);
  const [state, setState] = useState('loading');
  useEffect(() => {
    if (user?.role !== 'admin') return;
    let active = true;
    setState('loading');
    const args = {
      p_year: Number(year), p_month: Number(month), p_site: site || null,
      p_register: register === 'all' ? null : register,
    };
    Promise.all([supabase.rpc('monthly_payment_report', args),
      supabase.rpc('monthly_identified_payers', args)]).then(([report, people]) => {
      if (!active) return;
      if (report.error) { setRows([]); setPayers(null); setState('error'); }
      else { setRows(report.data ?? []); setPayers(people.error ? null : people.data?.[0] ?? null);
        setState('ready'); }
    }).catch(() => { if (active) { setRows([]); setPayers(null); setState('error'); } });
    return () => { active = false; };
  }, [user?.role, year, month, site, register]);

  const summary = useMemo(() => summarizeMonthlyPayments(rows), [rows]);
  if (user?.role !== 'admin') return null;

  const exportExcel = () => {
    const csv = monthlyReportCsv(rows, year, month);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `shafan-payments-${year}-${String(month).padStart(2, '0')}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <section dir="rtl" className="space-y-4 rounded-2xl border bg-card p-5 print:border-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold">סיכום תשלומים חודשי</h2>
        <p className="text-sm text-muted-foreground">דוח תפעולי מתשלומים שהושלמו; אינו דוח Z מאושר. מכירות ישנות ללא תנועת תשלום מאומתת אינן נכללות.</p></div>
      <div className="flex gap-2 print:hidden">
        <button type="button" onClick={exportExcel} disabled={state !== 'ready'}
          className="rounded border px-3 py-2 text-sm disabled:opacity-50">ייצוא לאקסל (CSV)</button>
        <button type="button" onClick={() => window.print()} disabled={state !== 'ready'}
          className="rounded border px-3 py-2 text-sm disabled:opacity-50">הדפסה / PDF</button>
      </div>
    </div>
    <div className="flex flex-wrap gap-3 print:hidden">
      <label>שנה <input aria-label="שנת הדוח" type="number" min="2020" max="2100"
        value={year} onChange={event => setYear(event.target.value)} className="w-24 rounded border p-2" /></label>
      <label>חודש <select aria-label="חודש הדוח" value={month}
        onChange={event => setMonth(event.target.value)} className="rounded border p-2">
        {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
      </select></label>
      <label>אתר <select aria-label="אתר הדוח" value={site}
        onChange={event => setSite(event.target.value)} className="rounded border p-2">
        <option value="">כל האתרים, כולל לא ידוע</option>
        {ACCOUNTING_SITES.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <label>מסוף <select aria-label="מסוף הדוח" value={register}
        onChange={event => setRegister(event.target.value)} className="rounded border p-2">
        <option value="all">כל המסופים</option><option value="">ללא מסוף</option>
        {registers.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
    </div>
    {state === 'loading' && <p>טוען נתונים…</p>}
    {state === 'error' && <p role="alert" className="text-red-700">לא ניתן לטעון את הדוח. לא מוצגים סכומים חלקיים.</p>}
    {state === 'ready' && <>
      <div className="grid gap-3 sm:grid-cols-4">
        <p>תשלומים שהושלמו: <strong>{summary.total.payments}</strong></p>
        <p>ברוטו: <strong>{money(summary.total.gross)}</strong></p>
        <p>החזרים: <strong>{summary.total.refunds} · {money(summary.total.refunded)}</strong></p>
        <p>נטו: <strong>{money(summary.total.net)}</strong></p>
      </div>
      <p className="text-sm text-muted-foreground">לקוחות משלמים מזוהים: {payers ? `${payers.identified_customers} (תשלומים ללא זיהוי שמור: ${payers.unidentified_payments})` : 'לא זמין'}.
        זיכויים רשמיים: אין במקורות הקיימים מספר וסכום מלאים ומהימנים; אינם נספרים כאפס.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr><th className="p-2 text-right">אמצעי תשלום</th><th>תשלומים</th><th>ברוטו</th><th>החזרים</th><th>נטו</th></tr></thead>
        <tbody>{summary.byMethod.map(([method, value]) => <tr key={method} className="border-t">
          <td className="p-2">{method}</td><td>{value.payments}</td><td>{money(value.gross)}</td>
          <td>{value.refunds} · {money(value.refunded)}</td><td>{money(value.net)}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr><th className="p-2 text-right">יום</th><th>תשלומים</th><th>ברוטו</th><th>החזרים</th><th>נטו</th></tr></thead>
        <tbody>{summary.byDay.map(([day, value]) => <tr key={day} className="border-t">
          <td className="p-2">{day}</td><td>{value.payments}</td><td>{money(value.gross)}</td>
          <td>{value.refunds} · {money(value.refunded)}</td><td>{money(value.net)}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr><th className="p-2 text-right">אתר</th><th>תשלומים</th><th>ברוטו</th><th>החזרים</th><th>נטו</th></tr></thead>
        <tbody>{summary.bySite.map(([name, value]) => <tr key={name} className="border-t">
          <td className="p-2">{name}</td><td>{value.payments}</td><td>{money(value.gross)}</td>
          <td>{value.refunds} · {money(value.refunded)}</td><td>{money(value.net)}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
