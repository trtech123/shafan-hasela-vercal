import { useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import OrderCustomerLink from '@/components/customers/OrderCustomerLink';
import { billingReviewIssues } from '@/payments/payperBilling';
import { redirectOrderPayment, requestOrderPayment } from '@/payments/orderPayments';

const billingCodes = new Set(['vat_required', 'billing_identity_required', 'billing_email_required']);
const issuesInHebrew = {
  vat_required: 'יש לקבוע מדיניות מע״מ בכרטיס הלקוח ולשמור אותה בהזמנה.',
  billing_identity_required: 'חסרים שם או מספר זיהוי תקינים לחיוב.',
  billing_email_required: 'חסרה כתובת דוא״ל תקינה למסמך.',
  invoice_lines_required: 'חסר תיאור פעילות תקין לשורת החשבונית בהזמנה.',
  digital_partial_unsupported: 'קיימת גבייה קודמת. יש לבדוק את היתרה עם מנהל לפני תשלום דיגיטלי.',
  accounting_review_required: 'קיים מסמך חשבונאי המחייב בדיקה לפני חיוב נוסף.',
  order_not_payable: 'ההזמנה אינה זמינה לתשלום.',
};
const boundedRequest = (client, body, milliseconds) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`order_${body.action}_timeout`)), milliseconds);
  requestOrderPayment(client, body).then(
    value => { clearTimeout(timer); resolve(value); },
    error => { clearTimeout(timer); reject(error); },
  );
});

export default function OrderDigitalCheckout({ orderId, balanceMinor, onStatus }) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [billingOpen, setBillingOpen] = useState(false);
  const [order, setOrder] = useState(null);
  const [payment, setPayment] = useState(null);
  const [reviewRequired, setReviewRequired] = useState(false);

  const openBilling = async () => {
    const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (error || !data) throw new Error('order_unavailable');
    setOrder(data);
    setBillingOpen(true);
  };

  const pay = async () => {
    if (locked.current || reviewRequired) return;
    locked.current = true; setBusy(true); setMessage('');
    try {
      const view = await boundedRequest(supabase, { action: 'status', orderId }, 20000);
      setPayment(view);
      if (view.paid) { setMessage('ההזמנה כבר שולמה.'); onStatus?.(); return; }
      if (view.payment?.canResume && view.redirectUrl &&
        Number.isFinite(view.hostedDeadlineMs) && view.hostedDeadlineMs > performance.now()) {
        redirectOrderPayment(view.redirectUrl);
        return;
      }
      const issues = view.eligibilityIssues || [];
      const defaults = view.billingDefaults;
      const blocking = issues.filter(issue => !billingCodes.has(issue));
      if (blocking.length || (view.payment && !view.canInitialize)) {
        setMessage(blocking.map(issue => issuesInHebrew[issue]).filter(Boolean).join(' ') ||
          'קיים ניסיון תשלום המחייב בדיקה לפני חיוב נוסף.');
        return;
      }
      if (issues.some(issue => billingCodes.has(issue)) || !defaults || billingReviewIssues(defaults).length) {
        setMessage(issues.map(issue => issuesInHebrew[issue]).filter(Boolean).join(' ') ||
          'יש להשלים פרטי חיוב בכרטיס הלקוח לפני התשלום.');
        await openBilling();
        return;
      }
      if (issues.length || !view.canInitialize) {
        setMessage(issues.map(issue => issuesInHebrew[issue]).filter(Boolean).join(' ') ||
          'לא ניתן לפתוח תשלום חדש. יש לבדוק את התשלום הקיים.');
        return;
      }
      if (view.amountMinor !== balanceMinor) {
        setMessage('יתרת ההזמנה השתנתה. רעננו את היתרה לפני תשלום.');
        onStatus?.();
        return;
      }
      const started = await boundedRequest(supabase, { action: 'initialize', orderId,
        expectedAmountMinor: view.amountMinor, previousPaymentId: view.payment?.id ?? null,
        billing: defaults }, 30000);
      setPayment(started);
      if (started.redirectUrl && !started.paid && started.payment?.canResume &&
        Number.isFinite(started.hostedDeadlineMs) && started.hostedDeadlineMs > performance.now()) {
        redirectOrderPayment(started.redirectUrl);
      } else setMessage('פתיחת התשלום החלה, אך מצב הדף אינו ודאי. בדקו את הניסיון הקיים לפני פעולה נוספת.');
    } catch (reason) {
      if (reason?.message === 'order_status_timeout') {
        setMessage('בדיקת התשלום מתעכבת. לא נפתח תשלום חדש. בדקו את החיבור ונסו שוב.');
      } else if (reason?.message === 'order_initialize_timeout') {
        setReviewRequired(true);
        setMessage('ניסיון התשלום עשוי להיות פעיל. בדקו את הניסיון הקיים לפני פעולה נוספת.');
      } else if (reason?.message === 'order_billing_incomplete' && reason.issues?.some(issue => billingCodes.has(issue))) {
        setMessage(reason.issues.map(issue => issuesInHebrew[issue]).filter(Boolean).join(' '));
        try { await openBilling(); } catch { setMessage('לא ניתן לפתוח את פרטי החיוב של ההזמנה.'); }
      } else setMessage('מצב התשלום אינו ודאי. בדקו את הניסיון הקיים לפני פעולה נוספת.');
    } finally { locked.current = false; setBusy(false); }
  };

  return <>
    <Button type="button" disabled={busy || reviewRequired || balanceMinor <= 0} onClick={pay}>
      {busy ? 'בודק וממשיך לתשלום…' : 'שלם באשראי דיגיטלי'}
    </Button>
    {message && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{message}</p>}
    {(reviewRequired || (payment?.payment && !payment.paid)) && <a className="text-sm text-primary underline"
      href={`/payment/order?orderId=${encodeURIComponent(orderId)}&review=1`}>
      בדיקת ניסיון התשלום הקיים
    </a>}
    <Dialog open={billingOpen} onOpenChange={setBillingOpen}>
      <DialogContent dir="rtl" aria-describedby="order-billing-help" className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>השלמת פרטי חיוב להזמנה</DialogTitle>
        <p id="order-billing-help" className="text-sm">יש לבחור לקוח או לעדכן רק את הפרטים החסרים, ולאשר במפורש את מדיניות המע״מ.</p>
        {order && <OrderCustomerLink order={order} requirePaymentReady onLinked={saved => {
          setOrder(saved); setBillingOpen(false); setMessage('פרטי החיוב נשמרו. לחצו שוב על ״שלם באשראי דיגיטלי״ כדי להמשיך.');
          onStatus?.();
        }} />}
      </DialogContent>
    </Dialog>
  </>;
}
