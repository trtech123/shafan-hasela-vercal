import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { requestOrderPayment, redirectOrderPayment, validOrderId } from '@/payments/orderPayments';

const labels = { initiated: 'ממתין לתשלום', pending_provider: 'ממתין לתוצאת תשלום', expired: 'הניסיון הקודם פג ונסגר ללא תשלום', failed: 'התשלום לא אושר', timed_out: 'תוצאת התשלום עדיין לא ידועה', succeeded: 'שולם במלואו' };

export default function OrderPayment() {
  const { user } = useAuth();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const orderId = params.get('orderId');
  const returnPaymentId = params.get('returned') === '1' ? params.get('paymentId') : null;
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [initializationAttempted, setInitializationAttempted] = useState(false);
  const [, tick] = useState(0);
  const locked = useRef(false);
  const generation = useRef(0);
  const handledReturn = useRef(null);
  const admin = user?.role === 'admin';
  const locallyExpired = Number.isFinite(view?.hostedDeadlineMs) && view.hostedDeadlineMs <= performance.now();
  const canResume = view?.payment?.canResume && Number.isFinite(view?.hostedDeadlineMs) && !locallyExpired;
  useEffect(() => {
    if (!Number.isFinite(view?.hostedDeadlineMs)) return;
    const delay = view.hostedDeadlineMs - performance.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => tick(value => value + 1), Math.min(delay + 1, 900001));
    return () => clearTimeout(timer);
  }, [view]);

  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setView(null); setError(''); setInitializationAttempted(false); locked.current = false;
    if (!admin || !validOrderId(orderId)) return;
    locked.current = true; setBusy(true);
    const load = async () => {
      try {
        const saved = await requestOrderPayment(supabase, { action: 'status', orderId });
        if (!active) return;
        setView(saved);
        if (returnPaymentId && handledReturn.current !== returnPaymentId && saved.payment?.id === returnPaymentId && saved.payment.canVerify && !saved.paid) {
          handledReturn.current = returnPaymentId;
          // Consume the marker before verification so refresh/back is status-only.
          const clean = new URL(window.location.href); clean.searchParams.delete('returned');
          window.history.replaceState(window.history.state, '', clean.pathname + clean.search);
          try {
            const verified = await requestOrderPayment(supabase, { action: 'verify', orderId, paymentId: returnPaymentId });
            if (active) setView(verified);
          } catch {
            if (active) setError('תוצאת התשלום אינה ודאית. יש לבדוק את מצב התשלום הקיים.');
            const latest = await requestOrderPayment(supabase, { action: 'status', orderId });
            if (active) setView(latest);
          }
        }
      } catch { if (active) setError('לא ניתן לקרוא את מצב התשלום. יש לוודא שהחיבור וההרשאות תקינים.'); }
      finally { if (active && generation.current === current) { locked.current = false; setBusy(false); } }
    };
    load();
    return () => { active = false; generation.current++; };
  }, [admin, orderId, returnPaymentId]);

  const act = async (action) => {
    if (locked.current || (action === 'initialize' && initializationAttempted)) return;
    locked.current = true; setBusy(true); setError('');
    if (action === 'initialize') setInitializationAttempted(true);
    const current = generation.current;
    try {
      const body = { action, orderId };
      if (action === 'initialize') { body.expectedAmountMinor = view.amountMinor; body.previousPaymentId = view.payment?.id ?? null; }
      if (action === 'resume' || action === 'verify') body.paymentId = view.payment.id;
      const result = await requestOrderPayment(supabase, body);
      if (generation.current !== current) return;
      setView(result);
      if ((action === 'resume' || action === 'initialize') && result.redirectUrl && !result.paid && result.payment?.canResume && Number.isFinite(result.hostedDeadlineMs) && result.hostedDeadlineMs > performance.now()) redirectOrderPayment(result.redirectUrl);
    } catch {
      if (generation.current !== current) return;
      setError('תוצאת התשלום אינה ודאית. יש לבדוק את מצב התשלום הקיים.');
      if (action !== 'status') {
        try {
          const saved = await requestOrderPayment(supabase, { action: 'status', orderId });
          if (generation.current === current) setView(saved);
        } catch { /* Keep uncertainty visible; never retry initialization. */ }
      }
    } finally { if (generation.current === current) { locked.current = false; setBusy(false); } }
  };

  if (!admin) return <p dir="rtl" className="p-8">התשלום זמין למנהלי מערכת בלבד</p>;
  if (!validOrderId(orderId)) return <p dir="rtl" className="p-8">לא נבחרה הזמנה תקינה</p>;
  return <main dir="rtl" className="max-w-xl mx-auto p-6 space-y-6">
    <Link to="/orders" className="text-sm text-primary">חזרה להזמנות</Link>
    <h1 className="text-2xl font-bold">פלאקארד — תשלום באשראי</h1>
    {error && <p role="alert" className="rounded-xl bg-amber-50 text-amber-900 p-4">{error}</p>}
    {view && <section className="rounded-2xl border bg-white p-6 space-y-4">
      <h2 className="font-semibold">הזמנה {view.orderNumber}</h2>
      <p className="text-sm text-muted-foreground">סכום ההזמנה השמור במערכת</p>
      <p className="text-4xl font-bold">{(view.amountMinor / 100).toFixed(2)} ₪</p>
      <p role="status">{view.paid ? 'שולם במלואו' : labels[view.payment?.status] || 'טרם שולם'}</p>
      {!view.paid && (view.payment?.hostedState === 'expired' || locallyExpired) && <p className="text-amber-800">פג תוקף דף התשלום הקודם. {view.payment?.status === 'expired' ? `הניסיון הקודם נסגר ללא תשלום. ${view.canInitialize ? 'ניתן לפתוח ניסיון חדש.' : 'פתיחת ניסיון חדש אינה זמינה כרגע.'}` : 'יש לבדוק את תוצאת התשלום. אם התוצאה אינה ודאית, לא ייפתח ניסיון נוסף עד לסיום הבירור מול פלאקארד.'}</p>}
      {!view.paid && view.verification?.approved === false && <p className="text-amber-800">{view.verification.resolution === 'unknown' ? 'לא התקבלה הוכחה סופית לתוצאת התשלום. הניסיון הקיים נשמר לבירור, ללא ניסיון חיוב נוסף.' : 'התשלום לא אושר בבדיקה האחרונה. יש לבדוק את התשלום הקיים לפני ניסיון נוסף.'}</p>}
      {view.paid && <p>אמצעי תשלום: אשראי — פלאקארד</p>}
      {view.accountingHeld && <p className="text-amber-800">לא יופק מסמך חשבונאי אוטומטי עבור תשלום זה.</p>}
      {view.paid && view.payment?.saleId && <Link className="block text-primary underline" to="/sales-report">דוח קופה — צפייה במכירה המקושרת</Link>}
      {!view.paid && <div className="flex flex-wrap gap-3">
        {canResume && <Button disabled={busy} onClick={() => act('resume')}>המשך לתשלום הקיים</Button>}
        {view.payment?.canVerify && <Button variant="outline" disabled={busy} onClick={() => act('verify')}>בדוק תוצאת תשלום</Button>}
        {view.canInitialize && <Button disabled={busy || initializationAttempted} onClick={() => act('initialize')}>{view.payment ? 'צור ניסיון תשלום חדש' : 'התחל תשלום באשראי'}</Button>}
        {!view.canInitialize && !view.payment && <p>פתיחת תשלום חדש אינה זמינה כרגע.</p>}
      </div>}
    </section>}
    <Button variant="outline" disabled={busy} onClick={() => act('status')}>{busy ? 'בודק מצב תשלום…' : 'רענן מצב תשלום'}</Button>
  </main>;
}
