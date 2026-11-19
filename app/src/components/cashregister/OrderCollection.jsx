import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import OrderDigitalCheckout from './OrderDigitalCheckout';
import { billingReviewIssues } from '@/payments/payperBilling';
import { publishOrderChange } from '@/lib/orderEvents';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import OrderCustomerLink from '@/components/customers/OrderCustomerLink';
import { getPhysicalAvailability, startDirectPhysical, startHostedPhysical } from '@/payments/physical/client';

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
  const allowed = Boolean(user?.role);
  const nonphysicalAllowed = ['admin', 'קופאי', 'cashier'].includes(user?.role);
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
  const [billingOrder, setBillingOrder] = useState(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const [physicalBusy, setPhysicalBusy] = useState(false);
  const [physicalReview, setPhysicalReview] = useState(false);
  const [physicalAvailability, setPhysicalAvailability] = useState(null);
  const physicalKey = useRef(null);
  const requestKey = useRef(null);
  const locked = useRef(false);

  const refresh = async (resetAmount = false) => {
    const latest = await collect({ action: 'status', orderId });
    setView(latest);
    if (resetAmount) {
      setAmount((latest.balanceMinor / 100).toFixed(2));
      setMethod(current => latest.collectionEnabled?.[current] ? current
        : latest.collectionEnabled?.cash ? 'cash' : 'check');
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
      setMethod(latest.collectionEnabled?.cash ? 'cash' : 'check');
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
  const accountingReady = !view?.billingIssues?.length && !view?.accountingReviewRequired;
  const collectionBlocked = Boolean(view?.balanceMinor > 0 && (view?.unresolvedPayment ||
    view?.accountingReviewRequired || view?.billingIssues?.includes('accounting_review_required')));
  const physicalRoute = import.meta.env.VITE_PELECARD_PHYSICAL_DIRECT_ENABLED === 'true' ? 'direct' : 'hosted';
  const physicalAllowed = physicalAvailability?.visible === true && physicalAvailability.route === physicalRoute;
  const physicalReady = physicalAllowed && physicalAvailability.ready === true;
  useEffect(() => {
    if (!allowed || import.meta.env.VITE_PELECARD_PHYSICAL_ENABLED !== 'true') return;
    let active = true;
    getPhysicalAvailability(supabase, undefined, orderId).then(value => { if (active) setPhysicalAvailability(value); })
      .catch(() => { if (active) setPhysicalAvailability(null); });
    return () => { active = false; };
  }, [allowed, orderId]);
  const resultDocument = view?.documents?.find(doc => doc.paymentId === result?.paymentId);
  const accountingResult = resultDocument ?? result?.accounting;
  const openBilling = async () => {
    const { data, error: failure } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (failure || !data) { setError('לא ניתן לפתוח את פרטי החיוב של ההזמנה.'); return; }
    setBillingOrder(data); setBillingOpen(true);
  };
  const payPhysical = async () => {
    if (!physicalReady || import.meta.env.VITE_PELECARD_PHYSICAL_ENABLED !== 'true' ||
      physicalBusy || !view || view.balanceMinor <= 0 || view.unresolvedPayment || !accountingReady) return;
    physicalKey.current ||= crypto.randomUUID();
    const key = physicalKey.current;
    const direct = import.meta.env.VITE_PELECARD_PHYSICAL_DIRECT_ENABLED === 'true';
    localStorage.setItem('pelecard.physicalPending.v1', JSON.stringify({ requestKey: key, orderId, cart: null,
      mode: direct ? 'direct' : 'hosted' }));
    setPhysicalBusy(true); setError('');
    try {
      const result = await (direct ? startDirectPhysical : startHostedPhysical)(supabase, { requestKey: key, orderId,
        amountMinor: view.balanceMinor,
        workstationCode: localStorage.getItem('pelecard.physicalWorkstation.v1') || null });
      if (direct || result.state !== 'pending' || !result.redirectUrl) setPhysicalReview(true);
    } catch (reason) {
      if (reason?.message === 'physical_register_004_unavailable') {
        localStorage.removeItem('pelecard.physicalPending.v1');
        physicalKey.current = null;
        setError('לא נמצא מסופון CT20 משויך לקופה 004. בדקו את הגדרות המסופון.');
      } else {
        setError('מצב התשלום הפיזי אינו ודאי. בדקו את הניסיון הקיים לפני פעולה נוספת.');
        setPhysicalReview(true);
      }
    } finally { setPhysicalBusy(false); }
  };
  const submit = async () => {
    if (locked.current || !validAmount || !checkReady || !billingReady || !accountingReady || !view || view.unresolvedPayment) return;
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

  if (!allowed) return <p dir="rtl" className="p-6">יש להתחבר כדי לפתוח גבייה להזמנה.</p>;
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
        {collectionBlocked && <p role="status" className="rounded border border-amber-300 bg-amber-50 p-2 font-medium text-amber-900">תשלום בבדיקה</p>}
        {view.unresolvedPayment && <p role="alert" className="text-amber-800">קיים ניסיון תשלום שתוצאתו אינה ודאית. גבייה נוספת חסומה עד בירור.</p>}
        {view.balanceMinor > 0 && view.accountingReviewRequired && <p role="alert" className="text-amber-800">כבר קיים מסמך או ניסיון הפקה חשבונאי להזמנה. גבייה נוספת חסומה עד להתאמה חשבונאית.</p>}
      {view.balanceMinor > 0 && view.billingIssues?.length > 0 && <p role="alert" className="text-amber-800">לפני גבייה יש להשלים פרטי חיוב ומדיניות מע״מ מאומתים בהזמנה. לא יירשם תשלום עד להשלמה.</p>}
      {nonphysicalAllowed && view.balanceMinor > 0 && view.billingIssues?.some(issue => ['vat_required', 'billing_identity_required', 'billing_email_required', 'cash_vat_unsupported'].includes(issue)) &&
        <Button type="button" variant="outline" onClick={openBilling}>השלמת פרטי חיוב להזמנה זו</Button>}
        {view.documents?.map(doc => <p key={doc.paymentId} className="text-sm">
          מסמך עבור תשלום {doc.paymentId}: {doc.state === 'succeeded' ? `הופק ${doc.documentNumber}` :
            doc.state === 'reconciliation_required' ? 'נדרשת התאמה למסמך קיים מול Payper; אין להפיק מסמך נוסף' : 'ממתין להפקה'}
          {safeDocumentUrl(doc.documentUrl) && <a className="mr-2 text-primary underline" href={safeDocumentUrl(doc.documentUrl)} target="_blank" rel="noopener noreferrer">פתיחה והדפסה</a>}
        </p>)}
      </section>
      {import.meta.env.VITE_PELECARD_PHYSICAL_ENABLED === 'true' && view.balanceMinor > 0 &&
        (view.unresolvedPayment || physicalReview
          ? <Link className="inline-block rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 font-medium text-indigo-900"
              to={`/payment/physical?orderId=${encodeURIComponent(orderId)}`}>בדיקת תשלום קיים במסופון פיזי</Link>
          : collectionBlocked ? null
          : physicalAllowed
            ? <><Button type="button" disabled={!physicalReady || physicalBusy || !accountingReady} onClick={payPhysical}>
                {physicalBusy ? 'שולח למסופון…' : 'שלם במסופון פיזי'}</Button>
                {!physicalReady && <p role="status">תשלום במסופון ממתין להפעלה מבוקרת.</p>}</>
              : <p role="status">תשלום במסופון זמין לקופאי המורשה בלבד.</p>)}
      {import.meta.env.VITE_PELECARD_PHYSICAL_ENABLED !== 'true' && view.balanceMinor > 0 &&
        <p role="status" className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">תשלום במסופון פיזי מושבת עד לאימות מסלול פלאקארד והפעלתו.</p>}
      {nonphysicalAllowed && view.balanceMinor > 0 && view.paidMinor === 0 && !collectionBlocked &&
        <OrderDigitalCheckout orderId={orderId} balanceMinor={view.balanceMinor}
          onStatus={() => refresh(false).catch(() => setError('לא ניתן לרענן את יתרת ההזמנה.'))} />}
      {result && <section role="status" className="rounded-xl border bg-white p-4">
        <p>התשלום נרשם במכירה {result.receiptNumber}. זהו אישור פנימי בלבד.</p>
        {accountingResult?.state === 'succeeded' && safeDocumentUrl(accountingResult.documentUrl)
          ? <p>מסמך Payper רשמי {accountingResult.documentNumber} · <a className="text-primary underline" href={safeDocumentUrl(accountingResult.documentUrl)} target="_blank" rel="noopener noreferrer">פתיחה והדפסה</a></p>
          : <p>{accountingResult?.state === 'reconciliation_required'
            ? 'התשלום נשמר, אך תוצאת הפקת המסמך אינה ודאית. יש להתאים את המסמך הקיים מול Payper; אין להפיק מסמך נוסף.'
            : 'המסמך החשבונאי בהפקה או בבדיקה. רעננו את מצב המסמכים.'}</p>}
      </section>}
      {nonphysicalAllowed && view.balanceMinor > 0 && !collectionBlocked && !result &&
        !view.collectionEnabled?.cash && !view.collectionEnabled?.check &&
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">גבייה במזומן ובהמחאה אינה פעילה כעת.</p>}
      {nonphysicalAllowed && view.balanceMinor > 0 && !collectionBlocked && !result &&
        (view.collectionEnabled?.cash || view.collectionEnabled?.check) &&
        <section className="space-y-3 rounded-xl border bg-white p-5">
        <h2 className="font-bold">רישום תשלום שהתקבל</h2>
        {view.paidMinor > 0 && <p className="text-sm text-amber-800">הגבייה כאן היא של מלוא היתרה לאחר תשלומים קודמים.</p>}
        <label className="block">אמצעי תשלום<select className="mt-1 w-full rounded border p-2" value={method} onChange={e => setMethod(e.target.value)}>{view.collectionEnabled?.check && <option value="check">המחאה</option>}{view.collectionEnabled?.cash && <option value="cash">מזומן</option>}</select></label>
        <label className="block">סכום לגבייה (₪)<input className="mt-1 w-full rounded border p-2" type="number" value={amount} readOnly /></label>
        <p className="text-sm">לאחר קבלת התשלום תתבקש חשבונית מס/קבלה מ־Payper. הזמנה עם מסמך קיים מחייבת התאמה לפני גבייה נוספת.</p>
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
        <Button disabled={busy || !validAmount || !checkReady || !billingReady || !accountingReady} onClick={submit}>{busy ? 'שומר ובודק מסמך…' : 'רשום תשלום והפק מסמך'}</Button>
      </section>}
      <Dialog open={billingOpen} onOpenChange={setBillingOpen}>
        <DialogContent dir="rtl" aria-describedby="noncard-billing-help" className="max-h-[90vh] overflow-y-auto">
          <DialogTitle>השלמת פרטי חיוב להזמנה</DialogTitle>
          <p id="noncard-billing-help" className="text-sm">יש לבחור כרטיס לקוח מאומת, להשלים את הפרטים החסרים ולקבוע מדיניות מע״מ. לאחר השמירה חזרו לאישור התשלום.</p>
          {billingOrder && <OrderCustomerLink order={billingOrder} requirePaymentReady onLinked={saved => {
            setBillingOrder(saved); setBillingOpen(false);
            refresh(true).catch(() => setError('לא ניתן לרענן את פרטי החיוב.'));
          }} />}
        </DialogContent>
      </Dialog>
      <Button variant="outline" disabled={busy} onClick={() => refresh(false).catch(() => setError('לא ניתן לרענן את היתרה.'))}>רענן יתרה ומסמכים</Button>
    </>}
  </main>;
}
