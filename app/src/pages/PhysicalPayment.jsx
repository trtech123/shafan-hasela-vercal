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
  const { state } = useLocation();
  const navigate = useNavigate();
  const cart = state?.cart;
  const [requestKey] = useState(() => {
    const prior = storedPointer();
    if (prior) return prior.requestKey;
    return uuid.test(state?.checkoutId) ? state.checkoutId : crypto.randomUUID();
  });
  const [devices, setDevices] = useState([]);
  const [workstationCode, setWorkstationCode] = useState(localStorage.getItem(workstationKey) || '');
  const [billing, setBilling] = useState({ kind: 'person', name: '', identity: '', email: '' });
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed = ['admin', 'קופאי'].includes(user?.role);

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
  const prepare = async () => {
    if (busy || view || !selected || !cart?.lines?.length || billingReviewIssues(billing).length) return;
    setBusy(true); setError('');
    localStorage.setItem(pointerKey, JSON.stringify({ requestKey, cart: JSON.stringify(cart) }));
    localStorage.setItem(workstationKey, workstationCode);
    try {
      const saved = await requestPhysicalPayment(supabase, { action: 'prepare', requestKey,
        workstationCode, cart, billing });
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
    <Link to="/cashregister" className="text-primary underline">חזרה לקופה</Link>
    <h1 className="text-2xl font-bold">תשלום במסופון פיזי</h1>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">{error}</p>}
    {view ? <section className="space-y-4 rounded-xl border p-5">
      {view.state === 'reserved' || view.state === 'approved' || view.state === 'canceled'
        ? <p role="status">{view.state === 'reserved' ? 'הבקשה נשמרה. ממתינים לשליחה למסופון.' :
          view.state === 'approved' ? 'התשלום אושר. משלימים את שמירת המכירה.' : 'הבקשה בוטלה לפני שליחה למסופון.'}</p>
        : <PhysicalTerminalStatus state={view.state === 'dispatching' ? 'pending' : view.state}
          deviceName={`${view.registerNumber} · ${selected?.label || 'מסופון פיזי'}`}
          amount={view.amountMinor / 100} onCheckStatus={verify} onBack={() => navigate('/cashregister')} />}
      <p>מסופון: {view.registerNumber} · סכום מאומת: {(view.amountMinor / 100).toFixed(2)} ₪</p>
      {['reserved', 'approved'].includes(view.state) && <button type="button" onClick={verify} disabled={busy}
        className="rounded-lg bg-indigo-700 px-4 py-2 text-white">בדיקת מצב העסקה</button>}
      {view.state === 'reserved' && <button type="button" onClick={cancel} disabled={busy}
        className="rounded-lg border px-4 py-2">בטל בקשה לפני שליחה</button>}
      {view.state === 'succeeded' && <Link to="/sales-report" className="text-primary underline">צפייה במכירה</Link>}
      {view.state === 'canceled' && <Link to="/cashregister" className="text-primary underline">חזרה לקופה</Link>}
    </section> : <section className="space-y-4 rounded-xl border p-5">
      <p>הסכום יחושב ויאומת בשרת. הקופאי לא יקליד סכום במסופון.</p>
      <label className="block">מסופון משויך<select className="mt-1 w-full rounded border p-2" value={workstationCode}
        onChange={event => setWorkstationCode(event.target.value)}>
        <option value="">בחרו את עמדת הקופה</option>
        {devices.map(device => <option key={device.registerNumber} value={device.workstationCode}>
          {device.label} · {device.model} · {device.registerNumber}</option>)}
      </select></label>
      <label className="block">סוג לקוח<select className="mt-1 w-full rounded border p-2" value={billing.kind}
        onChange={update('kind')}><option value="person">יחיד</option><option value="organization">חברה</option></select></label>
      <label className="block">שם מלא<input className="mt-1 w-full rounded border p-2" value={billing.name} onChange={update('name')} /></label>
      <label className="block">תעודת זהות<input className="mt-1 w-full rounded border p-2" value={billing.identity} onChange={update('identity')} inputMode="numeric" /></label>
      <label className="block">דואר אלקטרוני<input className="mt-1 w-full rounded border p-2" value={billing.email} onChange={update('email')} type="email" /></label>
      {billingReviewIssues(billing).length > 0 && <p className="text-sm text-amber-800">יש להשלים פרטי חיוב תקינים לפני שמירת הסל.</p>}
      <button type="button" disabled={busy || !selected || !cart?.lines?.length || billingReviewIssues(billing).length > 0} onClick={prepare}
        className="rounded-lg bg-indigo-700 px-4 py-2 text-white disabled:opacity-50">שמור סל ובדוק סכום בשרת</button>
      {!cart && <p role="alert">לא נמצא סל חדש. אם יש עסקה קיימת, מצב העסקה ייטען אוטומטית.</p>}
    </section>}
  </main>;
}
