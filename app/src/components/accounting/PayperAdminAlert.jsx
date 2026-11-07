import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';

export default function PayperAdminAlert() {
  const [count, setCount] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const { count, error } = await supabase.from('payper_accounting_exceptions')
          .select('payment_id', { count: 'exact', head: true }).eq('actionable', true);
        if (!active) return;
        if (error) { setUnavailable(true); return; }
        setCount(count ?? 0);
        setUnavailable(false);
      } catch { if (active) setUnavailable(true); }
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!count && !unavailable) { setExpanded(true); return; }
    if (!expanded) return;
    const timer = setTimeout(() => setExpanded(false), 8_000);
    return () => clearTimeout(timer);
  }, [count, unavailable, expanded]);
  if (!count && !unavailable) return null;
  if (!expanded) return <Link to="/accounting-operations" dir="rtl"
    className="inline-flex max-w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-950">
    {unavailable ? 'Payper: הבקרה אינה זמינה — בקרת הנה״ח'
      : `Payper: ${count} תשלומים לטיפול — בקרת הנה״ח`}
  </Link>;
  return <div role="alert" dir="rtl"
    className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-900">
    <Link to="/accounting-operations" className="min-w-0 flex-1">
      {unavailable ? 'בקרת מסמכי Payper אינה זמינה — יש לבדוק את יומן החשבונות'
        : `${count} תשלומים מחייבים טיפול במסמך Payper — פתחו את בקרת הנה״ח`}
    </Link>
    <button type="button" aria-label="סגור התראת Payper" onClick={() => setExpanded(false)}
      className="shrink-0 rounded p-1 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-700">
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  </div>;
}
