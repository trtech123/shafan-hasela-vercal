import { Loader2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

const content = {
  pending: {
    icon: Loader2,
    title: 'ממתינים לתשלום במסופון',
    description: 'הסכום נשלח למסופון. בקשו מהלקוח להצמיד או להכניס כרטיס.',
  },
  uncertain: {
    icon: AlertTriangle,
    title: 'מצב התשלום טרם אומת',
    description: 'ייתכן שהחיוב בוצע. בדקו שוב את מצב העסקה לפני פתיחת תשלום חדש.',
  },
  declined: {
    icon: XCircle,
    title: 'התשלום נדחה',
    description: 'פלאקארד אישרה שהעסקה לא חויבה. אפשר לבחור אמצעי תשלום אחר.',
  },
  succeeded: {
    icon: CheckCircle2,
    title: 'התשלום אושר והמכירה נשמרה',
    description: 'מצב החשבונית יוצג לאחר אימות ההנפקה והשליחה.',
  },
};

export default function PhysicalTerminalStatus({ state, deviceName, amount, onCheckStatus, onBack }) {
  const view = content[state];
  if (!view) return null;
  const Icon = view.icon;
  return <section dir="rtl" role="status" className="mx-auto max-w-md rounded-2xl bg-slate-800 p-6 text-white space-y-4">
    <Icon aria-hidden="true" className={`h-10 w-10 ${state === 'pending' ? 'animate-spin' : ''}`} />
    <h2 className="text-xl font-bold">{view.title}</h2>
    <p className="text-slate-200">{view.description}</p>
    <p className="text-sm text-slate-300">{deviceName} · {amount.toLocaleString('he-IL')} ₪</p>
    {(state === 'pending' || state === 'uncertain') && <button type="button" onClick={onCheckStatus}
      className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold">בדיקת מצב העסקה</button>}
    {(state === 'declined' || state === 'succeeded') && <button type="button" onClick={onBack}
      className="rounded-lg border border-slate-400 px-4 py-2">המשך</button>}
  </section>;
}
