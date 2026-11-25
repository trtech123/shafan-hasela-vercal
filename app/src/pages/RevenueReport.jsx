import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { formatRevenue, REVENUE_KINDS, revenueCsv, summarizeRevenueRows } from '@/lib/revenueReport';

const SITES = ['עכו', 'טבריה', 'נוף הגליל', 'שטח', 'פודטראק', 'קפה אקסטרים'];
const CUSTOMER_TYPES = ['חינוכית', 'גפ״ן', 'סוכן/מפיק', 'חברה', 'לקוח פרטי'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric',
  month: '2-digit', day: '2-digit' }).format(new Date());
const thirtyDaysAgo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 29 * 86400000));

export default function RevenueReport() {
  const [from, setFrom] = useState(thirtyDaysAgo);
  const [to, setTo] = useState(today);
  const [site, setSite] = useState('');
  const [customerType, setCustomerType] = useState('');
  const [submitted, setSubmitted] = useState({ from: thirtyDaysAgo(), to: today(), site: '', customerType: '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      const { data, error: queryError } = await supabase.rpc('get_revenue_report', {
        p_from: submitted.from, p_to: submitted.to,
        p_site: submitted.site || null, p_customer_type: submitted.customerType || null,
      });
      if (!active) return;
      if (queryError) {
        setRows([]);
        setError('לא ניתן לטעון את הדוח. בדקו שהמיגרציה הוחלה ושהמשתמש הוא מנהל.');
      } else {
        setRows(data?.rows || []);
        setLoaded(true);
      }
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [submitted]);

  const totals = useMemo(() => summarizeRevenueRows(rows), [rows]);
  const submit = event => {
    event.preventDefault();
    if (!from || !to || from > to) {
      setError('יש לבחור טווח תאריכים תקין.');
      return;
    }
    setSubmitted({ from, to, site, customerType });
  };
  const download = () => {
    const blob = new Blob([revenueCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `revenue-${submitted.from}-${submitted.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const cards = [
    ['סכום הזמנות פעילות', totals.orderMinor],
    ['הזמנות מבוטלות', totals.cancelledMinor],
    ['תקבולים שבוצעו', totals.receiptMinor],
    ['החזרים', totals.refundMinor],
    ['ביטולי חיוב', totals.voidMinor],
    ['תקבול נטו', totals.netMinor],
  ];

  return <div dir="rtl" className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
    <div>
      <h1 className="text-2xl font-bold text-slate-900">דוח הכנסות ותקבולים</h1>
      <p className="text-sm text-slate-600 mt-1">הזמנות לפי תאריך הפעילות; תקבולים, החזרים וביטולי חיוב לפי תאריך הפעולה. כל הסכומים בש״ח.</p>
    </div>
    <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
      <label className="text-sm font-medium">מתאריך<input aria-label="מתאריך" type="date" value={from} onChange={e => setFrom(e.target.value)} className="block w-full mt-1 rounded-md border border-slate-300 p-2" /></label>
      <label className="text-sm font-medium">עד תאריך<input aria-label="עד תאריך" type="date" value={to} onChange={e => setTo(e.target.value)} className="block w-full mt-1 rounded-md border border-slate-300 p-2" /></label>
      <label className="text-sm font-medium">אתר פעילות<select aria-label="אתר פעילות" value={site} onChange={e => setSite(e.target.value)} className="block w-full mt-1 rounded-md border border-slate-300 p-2">
        <option value="">כל האתרים</option>{SITES.map(value => <option key={value} value={value}>{value}</option>)}<option value="__unknown__">ללא אתר</option>
      </select></label>
      <label className="text-sm font-medium">סוג לקוח<select aria-label="סוג לקוח" value={customerType} onChange={e => setCustomerType(e.target.value)} className="block w-full mt-1 rounded-md border border-slate-300 p-2">
        <option value="">כל הסוגים</option>{CUSTOMER_TYPES.map(value => <option key={value} value={value}>{value}</option>)}<option value="__unknown__">ללא סיווג</option>
      </select></label>
      <button type="submit" disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 text-white px-4 py-2 disabled:opacity-50"><RefreshCw size={16} />הצג דוח</button>
    </form>
    {error && <p role="alert" className="rounded-md bg-red-50 text-red-800 p-3">{error}</p>}
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-600">{label}</div><div className="text-lg font-semibold mt-2 tabular-nums">₪{formatRevenue(value)}</div></div>)}
    </div>
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b"><h2 className="font-semibold">פירוט לפי יום, אתר, סוג לקוח ואמצעי</h2>
        <button type="button" onClick={download} disabled={!loaded || loading || !!error} className="inline-flex gap-2 items-center rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"><Download size={16} />ייצוא CSV לאקסל</button>
      </div>
      <div className="overflow-x-auto"><table className="min-w-full text-sm text-right"><thead className="bg-slate-50 text-slate-600"><tr>{['תאריך','אתר','סוג לקוח','נתון','אמצעי','אירועים','סכום'].map(label => <th key={label} className="px-4 py-3 whitespace-nowrap">{label}</th>)}</tr></thead><tbody>
        {rows.map((row, index) => <tr key={`${row.eventDate}-${row.site}-${row.customerType}-${row.kind}-${row.method}-${index}`} className="border-t border-slate-100">
          <td className="px-4 py-3 whitespace-nowrap">{row.eventDate}</td><td className="px-4 py-3">{row.site || 'ללא אתר'}</td><td className="px-4 py-3">{row.customerType || 'ללא סיווג'}</td><td className="px-4 py-3 whitespace-nowrap">{REVENUE_KINDS[row.kind] || row.kind}</td><td className="px-4 py-3">{row.method || '—'}</td><td className="px-4 py-3 tabular-nums">{row.eventCount}</td><td className="px-4 py-3 tabular-nums whitespace-nowrap">₪{formatRevenue(row.amountMinor)}</td>
        </tr>)}
      </tbody></table>{!loading && rows.length === 0 && !error && <p className="text-center text-slate-500 p-8">אין נתונים לטווח ולסינון שנבחרו.</p>}{loading && <p className="text-center text-slate-500 p-8">טוען דוח…</p>}</div>
    </div>
    <p className="text-xs text-slate-500">סיווג לקוח נלקח מתמונת ההזמנה השמורה. רשומות ישנות ללא תמונה נשארות ללא סיווג. תקבולי קופה ללא הזמנה מקושרת נשארים ללא סוג לקוח; אתר שנשמר בעת התשלום מוצג, ובהיעדרו הרשומה נשארת ללא אתר. רישומי אשראי חיצוני, העברה או אפליקציה ללא אימות ספק אינם נספרים כתקבול. צ׳קים נספרים עם קבלתם, ולא כאישור לפירעון בבנק. סכום ההזמנה, סטטוס הביטול והאתר בהזמנות משקפים את מצבן הנוכחי; שינויים קודמים בהם אינם משוחזרים.</p>
  </div>;
}
