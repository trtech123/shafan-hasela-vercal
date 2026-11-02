import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';

export default function PayperAdminAlert() {
  const [count, setCount] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
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
  if (!count && !unavailable) return null;
  return <Link to="/accounting-operations" role="alert"
    className="block rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-900">
    {unavailable ? 'בקרת מסמכי Payper אינה זמינה — יש לבדוק את יומן החשבונות'
      : `${count} תשלומים מחייבים טיפול במסמך Payper — פתחו את בקרת הנה״ח`}
  </Link>;
}
