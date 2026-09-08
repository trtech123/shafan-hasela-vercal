import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import {
  getPendingPelecardAttempt,
  pollPelecardStatus,
  verifyPelecardReturn,
} from "@/payments/pelecardPayments";

const STATES = {
  succeeded: {
    title: "התשלום אושר",
    description: "התשלום אומת מול פלאקארד והמכירה נשמרה.",
    icon: CheckCircle2,
    color: "text-emerald-300",
  },
  failed: {
    title: "התשלום נדחה",
    description: "לא נוצרה מכירה. אפשר לחזור לקופה ולבחור אמצעי תשלום אחר.",
    icon: XCircle,
    color: "text-rose-300",
  },
  timed_out: {
    title: "הבדיקה הסתיימה ללא תשובה",
    description: "לא סומנה הצלחה. אפשר לנסות לבדוק שוב; אישור מאוחר עדיין יעבור אימות בשרת.",
    icon: Clock3,
    color: "text-amber-300",
  },
  missing: {
    title: "לא נמצא תשלום לבדיקה",
    description: "חזרו לקופה והתחילו תשלום מאומת חדש.",
    icon: AlertTriangle,
    color: "text-amber-300",
  },
  error: {
    title: "לא ניתן לבדוק את התשלום כרגע",
    description: "לא סומנה הצלחה ולא נוצרה מכירה מהמסך הזה. נסו שוב בעוד רגע.",
    icon: AlertTriangle,
    color: "text-amber-300",
  },
};

export default function PaymentReturn() {
  const location = useLocation();
  const [payment, setPayment] = useState(null);
  const [view, setView] = useState("checking");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const reconcile = async () => {
      const attempt = getPendingPelecardAttempt(window.sessionStorage);
      if (!attempt?.paymentId) {
        if (active) setView("missing");
        return;
      }

      const notification = {};
      new URLSearchParams(location.search).forEach((value, key) => {
        notification[key] = value;
      });
      if (Object.keys(notification).length > 0) {
        try {
          await verifyPelecardReturn(attempt.paymentId, notification, {
            client: supabase,
          });
        } catch {
          // Browser-return data is only a notification. Local status polling
          // remains authoritative even if return verification is unavailable.
        }
      }

      try {
        const result = await pollPelecardStatus(attempt.paymentId, {
          client: supabase,
          signal: controller.signal,
          onStatus: (status) => {
            if (active) {
              setPayment(status);
              setView(status.status === "pending_provider" ||
                  status.status === "initiated"
                ? "checking"
                : status.status);
            }
          },
        });
        if (!active) return;
        setPayment(result);
        setView(result.status);
      } catch (error) {
        if (!active || error?.code === "cancelled") return;
        setView(error?.code === "poll_timeout" ? "timed_out" : "error");
      }
    };

    reconcile();
    return () => {
      active = false;
      controller.abort();
    };
  }, [location.search]);

  if (view === "checking") {
    return (
      <main className="min-h-[70vh] grid place-items-center p-6" dir="rtl">
        <section className="w-full max-w-md rounded-3xl bg-slate-900 px-8 py-10 text-center text-white shadow-xl">
          <Loader2 className="mx-auto mb-5 h-12 w-12 animate-spin text-cyan-300" />
          <h1 className="text-2xl font-bold">בודקים את התשלום</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            ממתינים לאימות מאובטח מול פלאקארד. אין לסגור את החלון.
          </p>
          {payment?.amount && (
            <p className="mt-5 font-mono text-lg text-white">
              {payment.amount} {payment.currency}
            </p>
          )}
        </section>
      </main>
    );
  }

  const state = STATES[view] ?? STATES.error;
  const Icon = state.icon;
  return (
    <main className="min-h-[70vh] grid place-items-center p-6" dir="rtl">
      <section className="w-full max-w-md overflow-hidden rounded-3xl bg-slate-900 text-white shadow-xl">
        <div className="border-b border-white/10 px-8 py-9 text-center">
          <Icon className={`mx-auto mb-5 h-14 w-14 ${state.color}`} />
          <h1 className="text-2xl font-bold">{state.title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">{state.description}</p>
        </div>
        <div className="space-y-4 px-8 py-7">
          {payment?.amount && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">סכום</span>
              <span className="font-mono text-base">{payment.amount} {payment.currency}</span>
            </div>
          )}
          {payment?.receiptNumber && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">מספר קבלה</span>
              <span className="font-mono text-base">{payment.receiptNumber}</span>
            </div>
          )}
          <Link
            to="/cashregister"
            className="mt-3 block w-full rounded-xl bg-cyan-600 px-4 py-3 text-center font-semibold transition-colors hover:bg-cyan-500"
          >
            חזרה לקופה
          </Link>
        </div>
      </section>
    </main>
  );
}
