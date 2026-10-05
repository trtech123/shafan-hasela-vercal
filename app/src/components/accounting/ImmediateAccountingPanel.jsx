import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import OrderCustomerLink from '@/components/customers/OrderCustomerLink';
import { isOrderPaid, orderPaymentPath, validOrderId } from '@/payments/orderPayments';
import { ACCOUNTING_LABELS, IMMEDIATE_ORDER_COLUMNS, billingFromOrder, billingReady, checkDetailsReady, clearRejectedManualIntent, definitiveManualValidationError, documentLink, manualPaymentIntent, requestImmediateAccounting } from '@/accounting/immediateAccounting';

const CHECK_FIELDS = { bankCode: 'קוד בנק', branchNumber: 'מספר סניף', accountNumber: 'מספר חשבון', checkNumber: 'מספר המחאה', dueDate: 'תאריך פירעון' };
export default function ImmediateAccountingPanel() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <AdminPanel /> : null;
}
function AdminPanel() {
  const [orders, setOrders] = useState([]);
  const [orderId, setOrderId] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('orderId');
    return validOrderId(requested) ? requested : '';
  });
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const version = useRef(0);
  const [error, setError] = useState('');
  const [billingConfirmed, setBillingConfirmed] = useState(false);
  const [noPriorInvoice, setNoPriorInvoice] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [method, setMethod] = useState('cash');
  const [details, setDetails] = useState({});
  useEffect(() => {
    let active = true;
    supabase.from('orders').select(IMMEDIATE_ORDER_COLUMNS).order('created_at', { ascending: false }).limit(100).then(({ data, error: queryError }) => {
      if (!active) return;
      if (queryError) setError('לא ניתן לטעון הזמנות. יש לרענן את הדף.');
      else setOrders((data || []).filter(order => order.order_number !== 'ORD-1039'));
    }).catch(() => { if (active) setError('לא ניתן לטעון הזמנות. יש לרענן את הדף.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const current = ++version.current;
    setStatus(null); setError(''); setBillingConfirmed(false); setNoPriorInvoice(false); setPaymentConfirmed(false); setDetails({});
    const params = new URLSearchParams(window.location.search);
    setMethod(params.get('orderId') === orderId && params.get('method') === 'check' ? 'check' : 'cash');
    if (!orderId) return;
    setBusy(true);
    requestImmediateAccounting(supabase, 'status', orderId).then(data => { if (version.current === current) setStatus(data); })
      .catch(() => { if (version.current === current) setError('לא ניתן לאמת את מצב ההזמנה. יש לרענן מצב לפני פעולה.'); })
      .finally(() => { if (version.current === current) setBusy(false); });
    return () => { version.current++; };
  }, [orderId]);
  const selected = orders.find(order => order.id === orderId);
  const order = status?.order;
  const billing = status?.preparation?.billing || order?.billing || billingFromOrder(selected || {});
  const ready = billingReady(billing) && Boolean(billing.customerSnapshotId) && typeof billing.vatApplicable === 'boolean';
  const excluded = status?.historicalExcluded || order?.order_number === 'ORD-1039';
  const paid = Boolean(status?.manualPayment || status?.payment?.status === 'succeeded' || isOrderPaid(order?.payment_status));
  const canPay = Boolean(status && billing.customerSnapshotId && typeof billing.vatApplicable === 'boolean' && !excluded && !paid && order?.payment_status === 'לא שולם' && Number(order?.total_price) > 0 && status.canRecordManualPayment === true);
  const preparation = status?.preparation;
  const payperOwned = status?.documentProvider === 'payper' || status?.preparationBlocked === 'payper_activation_required';
  const url = preparation?.external_document_number ? documentLink(preparation.document_url) : null;
  const checkReady = method !== 'check' || checkDetailsReady(details);
  async function act(action) {
    if (lock.current || busy || !orderId) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (action === 'manual') {
        if (!paymentConfirmed || !billingConfirmed || !canPay || !ready || !checkReady) throw new Error('confirmation_required');
        const paymentDetails = method === 'check' ? details : {};
        const id = manualPaymentIntent(window.localStorage, orderId, method, paymentDetails);
        const { error: paymentError } = await supabase.rpc('complete_manual_order_payment', { p_order_id: orderId, p_method: method, p_idempotency_key: id, p_details: paymentDetails });
        if (paymentError) {
          if (definitiveManualValidationError(paymentError)) {
            const refreshed = await requestImmediateAccounting(supabase, 'status', orderId);
            if (clearRejectedManualIntent(window.localStorage, orderId, id, paymentError, refreshed)) {
              setStatus(refreshed); setBillingConfirmed(false); setPaymentConfirmed(false); setNoPriorInvoice(false);
              setError('פרטי התשלום נדחו ולא נרשם תשלום. יש לתקן את הפרטים ולאשר שוב.');
              return;
            }
          }
          throw paymentError;
        }
        setPaymentConfirmed(false); setBillingConfirmed(false); setNoPriorInvoice(false); setStatus(null);
        setStatus(await requestImmediateAccounting(supabase, 'status', orderId));
      } else {
        if (action === 'prepare' && (payperOwned || !billingConfirmed || !noPriorInvoice || !ready || !paid || excluded || !status?.billingReviewHash)) throw new Error('confirmation_required');
        setStatus(await requestImmediateAccounting(supabase, action, orderId, { billingConfirmed, noPriorInvoice, billingReviewHash: status?.billingReviewHash }));
        if (action === 'status') { setBillingConfirmed(false); setNoPriorInvoice(false); setPaymentConfirmed(false); }
      }
    } catch {
      setStatus(null);
      setError('הפעולה לא אושרה או שתוצאתה אינה ידועה. אין לבצע תשלום נוסף. יש לרענן מצב ולבדוק; לא יבוצע ניסיון חוזר אוטומטי.');
    } finally { lock.current = false; setBusy(false); }
  }
  return <section dir="rtl" className="space-y-4 rounded-3xl border bg-card p-5 shadow-sm" aria-label="תשלום מיידי והכנת מסמך">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">תשלום מיידי והכנת מסמך</h2><a className="text-sm text-sky-700 underline" href="/orders">יצירת הזמנה או עדכון פרטי חיוב</a></div>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">הפקת המסמכים מושהית. הכנה שומרת נתונים לבדיקה בלבד; לא מופק מסמך ולא נשלח דוא״ל.</p>
    <label className="block text-sm">בחירת הזמנה<select className="mt-1 block w-full rounded-lg border p-2" value={orderId} disabled={busy} onChange={event => setOrderId(event.target.value)}><option value="">בחירת הזמנה קיימת</option>{orders.map(item => <option key={item.id} value={item.id}>{item.order_number} — {item.billing_institution_name || item.organization || item.client_name}</option>)}</select></label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {orderId && <Button variant="outline" disabled={busy} onClick={() => act('status')}>רענון מצב</Button>}
    {busy && <p role="status">טוען…</p>}
    {status && <>
      <p>סכום ההזמנה: {Number(order.total_price).toFixed(2)} ₪ · {paid ? 'התשלום הושלם' : 'התשלום טרם אומת'}</p>
      {!paid && !excluded && selected && <fieldset disabled={busy}><OrderCustomerLink key={`${selected.id}:${selected.customer_record_version || 0}`} order={selected} onLinked={(updated) => { setOrders((old) => old.map((row) => row.id === updated.id ? updated : row)); setBillingConfirmed(false); setPaymentConfirmed(false); act('status'); }} /></fieldset>}
      {preparation && <p className="text-sm">ההכנה השמורה אינה משתנה בעקבות עדכון ההזמנה.{preparation.billing ? ' מוצגים פרטי החיוב שאושרו ונשמרו.' : ' מוצגים פרטי ההזמנה הנוכחיים.'}{Number.isSafeInteger(preparation.amountMinor) ? ` סכום ההכנה: ${(preparation.amountMinor / 100).toFixed(2)} ₪.` : ''}</p>}
      <dl className="grid gap-2 text-sm sm:grid-cols-2">{[['שם לחיוב', billing.name], ['ח.פ / ע.מ', billing.companyId], ['דוא״ל לחשבוניות', billing.email], ['טלפון', billing.phone]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value || 'חסר'}</dd></div>)}</dl>
      <p>מדיניות מע״מ שמורה: {billing.vatApplicable === true ? 'חייב במע״מ' : billing.vatApplicable === false ? 'לא חייב במע״מ — ההפקה חסומה עד לאימות מיפוי הספק' : 'טרם נבדקה — נדרש לקשר כרטיס לקוח עם בחירה מפורשת'}</p>
      {!ready && <p role="alert">פרטי החיוב חסרים או לא תקינים. יש לעדכן אותם בהזמנה לפני המשך.</p>}
      {payperOwned && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">PAYPER ממתין להפעלה עבור מסמכי תשלום בפלאקארד. הכנה והפקה נוספת בריווחית חסומות; מצב התשלום נשמר בנפרד.</p>}
      {status.mappingRequired && !payperOwned && <p role="alert">התשלום אומת, אך מיפוי פרטי האשראי דורש בדיקה לפני הכנת המסמך.</p>}
      {excluded ? <p role="alert">הזמנה היסטורית זו אינה כלולה בתהליך.</p> : <>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={billingConfirmed} disabled={busy || !ready} onChange={event => setBillingConfirmed(event.target.checked)} />בדקתי ואישרתי את פרטי החיוב המוצגים</label>
        {canPay && <div className="space-y-3 border-t pt-3">
          {!busy && <a className="inline-block text-sky-700 underline" href={orderPaymentPath(orderId)}>לתשלום באשראי דרך Pelecard</a>}
          <label className="block text-sm">אמצעי תשלום ידני<select className="mx-2 rounded border p-2" value={method} disabled={busy} onChange={event => { setMethod(event.target.value); setPaymentConfirmed(false); }}><option value="cash">מזומן</option><option value="check">המחאה</option></select></label>
          {method === 'check' && <p className="text-sm">המחאה שהתקבלה בדואר משויכת לקופה הכללית (GENERAL), ללא תלות באתר הפעילות.</p>}
          {method === 'check' && <div className="grid gap-3 sm:grid-cols-2">{Object.entries(CHECK_FIELDS).map(([key, label]) => <label key={key} className="text-sm">{label}<input className="mt-1 block w-full rounded border p-2" disabled={busy} type={key === 'dueDate' ? 'date' : 'text'} value={details[key] || ''} onChange={event => { setDetails(current => ({ ...current, [key]: event.target.value })); setPaymentConfirmed(false); }} /></label>)}</div>}
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={paymentConfirmed} disabled={busy} onChange={event => setPaymentConfirmed(event.target.checked)} />קיבלתי בפועל את מלוא סכום ההזמנה באמצעי שנבחר, ולא נרשם תשלום קודם</label>
          <Button disabled={busy || !ready || !billingConfirmed || !paymentConfirmed || !checkReady} onClick={() => act('manual')}>רישום תשלום שהתקבל</Button>
        </div>}
        {paid && !preparation && !payperOwned && <div className="space-y-3 border-t pt-3"><label className="flex gap-2 text-sm"><input type="checkbox" checked={noPriorInvoice} disabled={busy} onChange={event => setNoPriorInvoice(event.target.checked)} />בדקתי שלא הופקה חשבונית קודמת עבור ההזמנה</label><Button disabled={busy || !ready || !billingConfirmed || !noPriorInvoice || !status.billingReviewHash} onClick={() => act('prepare')}>שמירת הכנה לבדיקה — ללא הפקה</Button></div>}
      </>}
      <p role="status">מצב הנהלת חשבונות: {preparation ? (ACCOUNTING_LABELS[preparation.state] || 'דורש בדיקה') : 'טרם הוכנה בקשה'}</p>
      {preparation?.external_document_number && <p>מסמך Rivhit: {preparation.external_document_number}</p>}
      {url ? <a className="text-sky-700 underline" href={url} target="_blank" rel="noopener noreferrer">צפייה במסמך Rivhit</a> : preparation?.external_document_number ? <p>המסמך קיים, אך קישור מאומת אינו זמין. אין להפיק מסמך נוסף.</p> : null}
      {['dispatching', 'reconciliation_required', 'artifact_required', 'succeeded'].includes(preparation?.state) && !excluded && <Button variant="outline" disabled={busy} onClick={() => act('reconcile')}>בדיקת מסמך קיים בלבד</Button>}
    </>}
  </section>;
}
