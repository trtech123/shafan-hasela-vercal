import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';

const labels = { claimed: 'השליחה התחילה — יש לבדוק את התוצאה', accepted: 'שרת הדואר קיבל את ההודעה', uncertain: 'תוצאת השליחה אינה ידועה — אין לשלוח שוב', failed: 'השליחה נכשלה — נדרשת בדיקה' };
export default function VoucherEmail({ voucher }) {
  const [configured, setConfigured] = useState(false);
  const [delivery, setDelivery] = useState(null);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error: failure } = await supabase.from('voucher_email_deliveries').select('*').eq('voucher_id', voucher.id).maybeSingle();
        if (failure) throw failure;
        if (active) setDelivery(data);
        if (data) {
          const result = await supabase.from('voucher_email_events').select('*').eq('delivery_id', data.id).order('created_at');
          if (result.error) throw result.error;
          if (active) setEvents(result.data || []);
        }
        if (active) setLoaded(true);
      } catch { if (active) setError('לא ניתן לאמת את היסטוריית השליחה. יש לפתוח מחדש את פרטי השובר.'); }
      try {
        const result = await supabase.functions.invoke('voucher-accounting-email', { body: { action: 'status' } });
        if (active) setConfigured(!result.error && result.data?.configured === true);
      } catch { if (active) setConfigured(false); }
    })();
    return () => { active = false; };
  }, [voucher.id]);
  const act = async (send) => {
    if (lock.current || !loaded || (send && (!configured || events.length))) return;
    lock.current = true; setBusy(true); setError('');
    let dispatchStarted = false;
    try {
      let prepared = delivery;
      if (!prepared) {
        const { data, error: failure } = await supabase.rpc('prepare_voucher_email', { p_voucher_id: voucher.id, p_request_id: requestId });
        if (failure) throw failure;
        prepared = data; setDelivery(data);
      }
      if (send) {
        if (!prepared?.id) throw new Error('email_preparation_missing');
        dispatchStarted = true;
        const { data, error: failure } = await supabase.functions.invoke('voucher-accounting-email', { body: { voucherId: voucher.id, requestId: prepared.id } });
        if (failure || !data?.ok) throw new Error('send_uncertain');
        setEvents([{ status: data.status }]);
      } else {
        const blob = new Blob([JSON.stringify(voucher, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
        anchor.href = url; anchor.download = `voucher-${voucher.voucher_number || voucher.id}.json`; anchor.click(); URL.revokeObjectURL(url);
      }
    } catch {
      if (dispatchStarted) setEvents([{ status: 'uncertain' }]);
      setError('לא ניתן לאשר שהפעולה הושלמה. יש לבדוק את היסטוריית השובר לפני ניסיון נוסף.');
    }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="space-y-2 border-t pt-3" aria-label="העברה להנהלת חשבונות">
    <p>אימייל הוא תיעוד העברה בלבד; הוא אינו אישור תשלום או קליטה חשבונאית.</p>
    {delivery && <p>הוכנה בקשת העברה להנהלת חשבונות.</p>}
    {events.map((event, index) => <p key={event.id || index} role="status">{labels[event.status] || 'מצב שליחה דורש בדיקה'}{event.created_at ? ` · ${new Date(event.created_at).toLocaleString('he-IL')}` : ''}</p>)}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !loaded} onClick={() => act(false)}>הכנה מתועדת והורדת שובר</Button><Button disabled={busy || !loaded || !configured || events.length > 0} onClick={() => act(true)}>שליחה לנמען הנהלת החשבונות הקבוע</Button></div>
    {!configured && <p className="text-sm">שליחה אינה זמינה: נמען הנהלת החשבונות או שירות השליחה טרם הוגדרו.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
