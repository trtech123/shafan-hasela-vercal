import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { orderPaymentPath } from '@/payments/orderPayments';
import { billingReviewIssues } from '@/payments/payperBilling';
import { publishOrderChange } from '@/lib/orderEvents';
import { Button } from '@/components/ui/button';

const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
const shekels = minor => `${(Number(minor) / 100).toFixed(2)} ₪`;
const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const safeDocumentUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['app.payper.co.il', 'payper.co.il'].includes(url.hostname)
      && /^\/(?:app\/)?public\/invoice_show\/[0-9]+$/.test(url.pathname)
      && !url.username && !url.password && !url.port && !url.hash ? url.href : null;
  } catch { return null; }
};
const collect = async body => {
  const { data, error } = await supabase.functions.invoke('payper-noncard-collection', { body });
  if (error || data?.error) throw new Error(data?.error?.code || 'collection_unavailable');
  return data;
};

export default function OrderCollection({ orderId }) {
  const { user } = useAuth();
  const allowed = user?.role === 'admin' || user?.role === 'קופאי' || user?.role === 'cashier';
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState('check');
  const [amount, setAmount] = useState('');
  const [billing, setBilling] = useState({ kind: 'person', name: '', identity: '', email: '' });
  const [check, setCheck] = useState({ check_number: '', bank: '', branch: '', account_number: '',
    account_holder: '', received_date: today(), due_date: today() });
  const [result, setResult] = useState(null);
  const requestKey = useRef(null);
  const locked = useRef(false);

  const refresh = async (resetAmount = false) => {
    const latest = await collect({ action: 'status', orderId });
    setView(latest);
    if (resetAmount) {
      setAmount((latest.balanceMinor / 100).toFixed(2));
      setBilling({ kind: latest.billing?.kind || 'person', name: latest.billing?.name || '', identity: latest.billing?.identity || '',
        email: latest.billing?.email || '' });
    }
    return latest;
  };
  useEffect(() => {
    let active = true;
    if (!allowed || !validId(orderId)) { setLoading(false); return; }
    setLoading(true);
    collect({ action: 'status', orderId }).then(latest => {
      if (!active) return;
      setView(latest);
      setAmount((latest.balanceMinor / 100).toFixed(2));
      setBilling({ kind: latest.billing?.kind || 'person', name: latest.billing?.name || '', identity: latest.billing?.identity || '',
        email: latest.billing?.email || '' });
    }).catch(() => { if (active) setError('לא ניתן לטעון את יתרת ההזמנה.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed, orderId]);

  const amountMinor = Math.round(Number(amount) * 100);
  const validAmount = Number.isSafeInteger(amountMinor) && amountMinor > 0 &&
    Math.abs(Number(amount) * 100 - amountMinor) < 0.00001 &&
    amountMinor === view?.balanceMinor;
  const checkReady = method === 'cash' || (/^\d{1,20}$/.test(check.check_number)
    && check.bank.trim() && /^\d{1,8}$/.test(check.branch)
    && /^\d{1,20}$/.test(check.account_number) && check.account_holder.trim()
    && check.received_date && check.due_date && check.due_date >= check.received_date);
  const billingReady = billingReviewIssues(billing).length === 0;
  const submit = async () => {
    if (locked.current || !validAmount || !checkReady || !billingReady || !view || view.unresolvedPayment) return;
    locked.current = true; setBusy(true); setError('');
    requestKey.current ||= crypto.randomUUID();
    try {
      const saved = await collect({ action: 'collect', orderId, requestKey: requestKey.current,
        method, amountMinor, check: method === 'check' ? { ...check, amount } : null,
        billing, documentType: 'invoice-receipt', referenceDocumentId: null });
      setResult(saved);
      publishOrderChange();
      await refresh(true);
    } catch {
      setError('תוצאת השמירה אינה ודאית. בדקו את היתרה והמסמכים לפני ניסיון נוסף.');
      try { await refresh(false); } catch { /* Keep the same request key for safe recovery. */ }
    } finally { locked.current = false; setBusy(false); }
  };

  if (!allowed) return <p dir="rtl" className="p-6">גבייה זמינה למנהל ולקופאי בלבד.</p>;
  if (!validId(orderId)) return <p dir="rtl" className="p-6">מזהה ההזמנה אינו תקין.</p>;
  return <main dir="rtl" className="mx-auto max-w-2xl space-y-5 p-6 text-slate-900">
    <Link to="/schedule" className="text-primary underline">חזרה ללוח הזמנים</Link>
    <h1 className="text-2xl font-bold">גבייה בקופה מהזמנה קיימת</h1>
    {loading && <p>טוען הזמנה ויתרה…</p>}
    {error && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">{error}</p>}
    {view && <>
      <section className="space-y-2 rounded-xl border bg-white p-5">
        <h2 className="font-bold">{view.orderNumber} · {view.clientName}</h2>
        <p>{view.organization || ''} · {view.activityName || 'פעילות'} · {view.participants} משתתפים</p>
        {view.quoteId && <p>הצעת מחיר מקושרת להזמנה</p>}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <p>סכום ההזמנה<br /><strong>{shekels(view.totalMinor)}</strong></p>
          <p>תשלומים שנרשמו<br /><strong>{shekels(view.paidMinor)}</strong></p>
          <p>יתרה לגבייה<br /><strong>{shekels(view.balanceMinor)}</strong></p>
        </div>
        {view.payments?.length > 0 && <p className="text-sm">היסטוריית גבייה: {view.payments.filter(p => p.status === 'succeeded').length} תשלומים שנרשמו או אומתו</p>}
        {view.payments?.some(p => p.clearanceStatus === 'received_uncleared') && <p className="text-sm text-amber-800">המחאות שהתקבלו טרם נפרעו בבנק.</p>}
        {view.unresolvedPayment && <p role="alert" className="text-amber-800">קיים ניסיון תשלום שתוצאתו אינה ודאית. גבייה נוספת חסומה עד בירור.</p>}
        {view.accountingReviewRequired && <p role="alert" className="text-amber-800">כבר קיים מסמך או ניסיון הפקה חשבונאי להזמנה. התשלום החדש יישמר, והפקת מסמך נוסף תמתין להתאמה חשבונאית.</p>}
        {view.documents?.map(doc => <p key={doc.paymentId} className="text-sm">
          מסמך עבור תשלום {doc.paymentId}: {doc.state === 'succeeded' ? `הופק ${doc.documentNumber}` : 'ממתין או דורש התאמה'}
          {safeDocumentUrl(doc.documentUrl) && <a className="mr-2 text-primary underline" href={safeDocumentUrl(doc.documentUrl)} target="_blank" rel="noopener noreferrer">פתיחה והדפסה</a>}
        </p>)}
      </section>
      {result && <section role="status" className="rounded-xl border bg-white p-4">
        <p>התשלום נרשם במכירה {result.receiptNumber}. זהו אישור פנימי בלבד.</p>
        {result.accounting?.state === 'succeeded' && safeDocumentUrl(result.accounting.documentUrl)
          ? <p>מסמך Payper רשמי {result.accounting.documentNumber} · <a className="text-primary underline" href={safeDocumentUrl(result.accounting.documentUrl)} target="_blank" rel="noopener noreferrer">פתיחה והדפסה</a></p>
          : <p>המסמך החשבונאי טרם אושר להפקה. נדרשת בדיקה בבקרת הנהלת חשבונות.</p>}
      </section>}
      {view.balanceMinor > 0 && !view.unresolvedPayment && !result && <section className="space-y-3 rounded-xl border bg-white p-5">
        <h2 className="font-bold">רישום תשלום שהתקבל</h2>
        {view.paidMinor === 0 && <Link className="inline-block text-primary underline" to={orderPaymentPath(orderId)}>תשלום דיגיטלי בפלאקארד להזמנה זו</Link>}
        {view.paidMinor > 0 && <p className="text-sm text-amber-800">הגבייה כאן היא של מלוא היתרה לאחר תשלומים קודמים.</p>}
        <label className="block">אמצעי תשלום<select className="mt-1 w-full rounded border p-2" value={method} onChange={e => setMethod(e.target.value)}><option value="check">המחאה</option><option value="cash">מזומן</option></select></label>
        <label className="block">סכום לגבייה (₪)<input className="mt-1 w-full rounded border p-2" type="number" value={amount} readOnly /></label>
        <p className="text-sm">לאחר קבלת התשלום תתבקש חשבונית מס/קבלה מ־Payper. אם כבר קיים מסמך להזמנה, התשלום יישמר להשלמת התאמה חשבונאית.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label>סוג לקוח<select className="w-full rounded border p-2" value={billing.kind} onChange={e => setBilling({ ...billing, kind: e.target.value })}><option value="person">יחיד</option><option value="organization">ארגון</option></select></label>
          <label>שם לחיוב<input className="w-full rounded border p-2" value={billing.name} onChange={e => setBilling({ ...billing, name: e.target.value })} /></label>
          <label>מספר זהות / חברה<input className="w-full rounded border p-2" inputMode="numeric" value={billing.identity} onChange={e => setBilling({ ...billing, identity: e.target.value })} /></label>
          <label>דוא״ל למסמך<input className="w-full rounded border p-2" type="email" value={billing.email} onChange={e => setBilling({ ...billing, email: e.target.value })} /></label>
        </div>
        {method === 'check' && <div className="grid gap-2 sm:grid-cols-2">
          {[["check_number", "מספר המחאה"], ["bank", "בנק"], ["branch", "סניף"],
            ["account_number", "מספר חשבון"], ["account_holder", "בעל החשבון"],
            ["received_date", "תאריך קבלה"], ["due_date", "תאריך פירעון"]].map(([key, label]) =>
            <label key={key}>{label}<input className="w-full rounded border p-2" type={key.endsWith('date') ? 'date' : 'text'} value={check[key]} onChange={e => setCheck({ ...check, [key]: e.target.value })} /></label>)}</div>}
        <Button disabled={busy || !validAmount || !checkReady || !billingReady} onClick={submit}>{busy ? 'שומר ובודק מסמך…' : 'רשום תשלום והפק מסמך'}</Button>
      </section>}
      <Button variant="outline" disabled={busy} onClick={() => refresh(false).catch(() => setError('לא ניתן לרענן את היתרה.'))}>רענן יתרה ומסמכים</Button>
    </>}
  </main>;
}
