import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { requestPhysicalPayment } from '@/payments/physical/client';
import { billingReviewIssues } from '@/payments/payperBilling';
import PhysicalTerminalStatus from '@/components/cashregister/PhysicalTerminalStatus';

const pointerKey = 'pelecard.physicalPending.v1';
const workstationKey = 'pelecard.physicalWorkstation.v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unresolved = new Set(['reserved', 'dispatching', 'pending', 'uncertain', 'approved']);
function storedPointer() {
  try { const value = JSON.parse(localStorage.getItem(pointerKey) || 'null');
    return uuid.test(value?.requestKey) ? value : null;
  } catch { return null; }
}

export default function PhysicalPayment() {
  const { user } = useAuth();
  const { state, search } = useLocation();
  const navigate = useNavigate();
  const requestedOrderId = new URLSearchParams(search).get('orderId');
  const [entryPointer] = useState(storedPointer);
  const orderId = entryPointer ? entryPointer.orderId : requestedOrderId;
  const orderMode = Boolean(orderId);
  const cart = state?.cart;
  const [requestKey] = useState(() => {
    if (entryPointer) return entryPointer.requestKey;
    return uuid.test(state?.checkoutId) ? state.checkoutId : crypto.randomUUID();
  });
  const [devices, setDevices] = useState([]);
  const [workstationCode, setWorkstationCode] = useState(localStorage.getItem(workstationKey) || '');
  const [billing, setBilling] = useState({ kind: 'person', name: '', identity: '', email: '' });
  const [orderView, setOrderView] = useState(null);
  const [orderAmount, setOrderAmount] = useState('');
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed = ['admin', 'קופאי'].includes(user?.role);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!allowed || !orderMode || !uuid.test(orderId)) return;
    let active = true;
    supabase.functions.invoke('payper-noncard-collection', {
      body: { action: 'status', orderId },
    }).then(({ data, error: statusError }) => {
      if (!active) return;
      if (statusError || data?.error || data?.orderId !== orderId ||
        !Number.isSafeInteger(data.balanceMinor) || data.balanceMinor < 0)
        throw new Error('physical_order_status_unavailable');
      setOrderView(data);
      setOrderAmount((data.balanceMinor / 100).toFixed(2));
    }).catch(() => { if (active) setError('לא ניתן לטעון את יתרת ההזמנה. אין להתחיל תשלום נוסף.'); });
    return () => { active = false; };
  }, [allowed, orderId, orderMode]);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    requestPhysicalPayment(supabase, { action: 'devices' }).then(rows => {
      if (!active) return;
      setDevices(rows);
      setWorkstationCode(current => rows.some(row => row.workstationCode === current)
        ? current : (rows.length === 1 ? rows[0].workstationCode : ''));
    }).catch(() => { if (active) setError('לא ניתן לטעון מסופונים משויכים.'); });
    requestPhysicalPayment(supabase, { action: 'status', requestKey })
      .then(saved => { if (active) setView(saved); }).catch(() => {});
    return () => { active = false; };
  }, [allowed, requestKey]);

  useEffect(() => {
    if (!view || !unresolved.has(view.state)) return;
    const timer = setInterval(() => {
      requestPhysicalPayment(supabase, { action: 'status', requestKey })
        .then(setView).catch(() => setError('מצב התשלום אינו זמין כרגע. בדקו את העסקה הקיימת.'));
    }, 5000);
    return () => clearInterval(timer);
  }, [view, requestKey]);

  useEffect(() => {
    if (view && ['succeeded', 'declined', 'canceled'].includes(view.state)) localStorage.removeItem(pointerKey);
  }, [view]);

  const selected = devices.find(row => row.workstationCode === workstationCode);
  const update = key => event => setBilling(previous => ({ ...previous, [key]: event.target.value }));
  const orderAmountMinor = Math.round(Number(orderAmount) * 100);
  const validOrderAmount = orderMode && orderView && !orderView.unresolvedPayment &&
    Number.isSafeInteger(orderAmountMinor) && orderAmountMinor > 0 &&
    Math.abs(Number(orderAmount) * 100 - orderAmountMinor) < 0.00001 &&
    orderAmountMinor <= orderView.balanceMinor &&
    (isAdmin || orderAmountMinor === orderView.balanceMinor);
  const prepare = async () => {
    if (busy || view || !selected || (orderMode ? !validOrderAmount :
      (!cart?.lines?.length || billingReviewIssues(billing).length))) return;
    setBusy(true); setError('');
    localStorage.setItem(pointerKey, JSON.stringify({ requestKey, orderId: orderMode ? orderId : null,
      cart: orderMode ? null : JSON.stringify(cart) }));
    localStorage.setItem(workstationKey, workstationCode);
    try {
      const saved = await requestPhysicalPayment(supabase, orderMode
        ? { action: 'prepareOrder', requestKey, workstationCode, orderId,
          amountMinor: orderAmountMinor }
        : { action: 'prepare', requestKey, workstationCode, cart, billing });
      setView(saved);
    } catch {
      setError('לא ניתן לאמת את שמירת הבקשה. בדקו את מצב העסקה הקיימת לפני ניסיון נוסף.');
      try { setView(await requestPhysicalPayment(supabase, { action: 'status', requestKey })); } catch { /* Keep pointer for recovery. */ }
    } finally { setBusy(false); }
  };
  const verify = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { setView(await requestPhysicalPayment(supabase, { action: 'verify', requestKey })); }
    catch { setError('תוצאת התשלום עדיין אינה ודאית. אין לשלוח חיוב נוסף.'); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (busy || view?.state !== 'reserved') return;
    setBusy(true); setError('');
    try { setView(await requestPhysicalPayment(supabase, { action: 'cancel', requestKey })); }
    catch {
      setError('ייתכן שהשליחה למסופון כבר החלה. בדקו את מצב העסקה; אין להתחיל חיוב נוסף.');
      try { setView(await requestPhysicalPayment(supabase, { action: 'status', requestKey })); } catch { /* Keep pointer. */ }
    } finally { setBusy(false); }
  };

  if (!allowed) return <main dir="rtl" className="p-8">התשלום זמין למנהל ולקופאי בלבד.</main>;
  return <main dir="rtl" className="mx-auto max-w-xl space-y-5 p-6">
    <Link to={orderMode ? `/cashregister?orderId=${encodeURIComponent(orderId)}` : '/cashregister'} className="text-primary underline">חזרה לקופה</Link>
    <h1 className="text-2xl font-bold">תשלום במסופון פיזי</h1>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">{error}</p>}
    {orderMode && orderView && <section className="rounded-xl border p-4">
      <h2 className="font-bold">{orderView.orderNumber} · {orderView.clientName}</h2>
      <p>{orderView.organization || ''}</p>
      <p>סכום ההזמנה: {(orderView.totalMinor / 100).toFixed(2)} ₪ · שולם: {(orderView.paidMinor / 100).toFixed(2)} ₪</p>
      <p>יתרה לגבייה: {(orderView.balanceMinor / 100).toFixed(2)} ₪</p>
      {orderView.unresolvedPayment && <p role="alert">קיים תשלום שמצבו אינו ודאי. יש לברר אותו לפני גבייה נוספת.</p>}
    </section>}
    {view ? <section className="space-y-4 rounded-xl border p-5">
      {view.state === 'reserved' || view.state === 'approved' || view.state === 'canceled'
        ? <p role="status">{view.state === 'reserved' ? 'הבקשה נשמרה. ממתינים לשליחה למסופון.' :
          view.state === 'approved' ? 'התשלום אושר. משלימים את שמירת המכירה.' : 'הבקשה בוטלה לפני שליחה למסופון.'}</p>
        : <PhysicalTerminalStatus state={view.state === 'dispatching' ? 'pending' : view.state}
          deviceName={`${view.registerNumber} · ${selected?.label || 'מסופון פיזי'}`}
          amount={view.amountMinor / 100} onCheckStatus={verify} onBack={() => navigate(orderMode ? `/cashregister?orderId=${encodeURIComponent(orderId)}` : '/cashregister')} />}
      <p>מסופון: {view.registerNumber} · סכום מאומת: {(view.amountMinor / 100).toFixed(2)} ₪</p>
      {['reserved', 'approved'].includes(view.state) && <button type="button" onClick={verify} disabled={busy}
        className="rounded-lg bg-indigo-700 px-4 py-2 text-white">בדיקת מצב העסקה</button>}
      {view.state === 'reserved' && <button type="button" onClick={cancel} disabled={busy}
        className="rounded-lg border px-4 py-2">בטל בקשה לפני שליחה</button>}
      {view.state === 'succeeded' && <Link to={orderMode ? `/cashregister?orderId=${encodeURIComponent(orderId)}` : '/sales-report'} className="text-primary underline">{orderMode ? 'חזרה להזמנה וליתרה' : 'צפייה במכירה'}</Link>}
      {view.state === 'canceled' && <Link to="/cashregister" className="text-primary underline">חזרה לקופה</Link>}
    </section> : <section className="space-y-4 rounded-xl border p-5">
      <p>{orderMode ? 'יתרת ההזמנה וסכום הגבייה יאומתו בשרת לפני שליחה למסופון.' : 'הסכום יחושב ויאומת בשרת. הקופאי לא יקליד סכום במסופון.'}</p>
      <label className="block">מסופון משויך<select className="mt-1 w-full rounded border p-2" value={workstationCode}
        onChange={event => setWorkstationCode(event.target.value)}>
        <option value="">בחרו את עמדת הקופה</option>
        {devices.map(device => <option key={device.registerNumber} value={device.workstationCode}>
          {device.label} · {device.model} · {device.registerNumber}</option>)}
      </select></label>
      {orderMode ? <label className="block">סכום לגבייה (₪)<input className="mt-1 w-full rounded border p-2"
        type="number" min="0.01" max={orderView ? (orderView.balanceMinor / 100).toFixed(2) : undefined}
        step="0.01" value={orderAmount} disabled={!isAdmin || !orderView}
        onChange={event => setOrderAmount(event.target.value)} /></label> : <>
      <label className="block">סוג לקוח<select className="mt-1 w-full rounded border p-2" value={billing.kind}
        onChange={update('kind')}><option value="person">יחיד</option><option value="organization">חברה</option></select></label>
      <label className="block">שם מלא<input className="mt-1 w-full rounded border p-2" value={billing.name} onChange={update('name')} /></label>
      <label className="block">תעודת זהות<input className="mt-1 w-full rounded border p-2" value={billing.identity} onChange={update('identity')} inputMode="numeric" /></label>
      <label className="block">דואר אלקטרוני<input className="mt-1 w-full rounded border p-2" value={billing.email} onChange={update('email')} type="email" /></label>
      {billingReviewIssues(billing).length > 0 && <p className="text-sm text-amber-800">יש להשלים פרטי חיוב תקינים לפני שמירת הסל.</p>}</>}
      <button type="button" disabled={busy || !selected || (orderMode ? !validOrderAmount :
        (!cart?.lines?.length || billingReviewIssues(billing).length > 0))} onClick={prepare}
        className="rounded-lg bg-indigo-700 px-4 py-2 text-white disabled:opacity-50">{orderMode ? 'שמור תשלום להזמנה ובדוק סכום בשרת' : 'שמור סל ובדוק סכום בשרת'}</button>
      {!orderMode && !cart && <p role="alert">לא נמצא סל חדש. אם יש עסקה קיימת, מצב העסקה ייטען אוטומטית.</p>}
    </section>}
  </main>;
}
