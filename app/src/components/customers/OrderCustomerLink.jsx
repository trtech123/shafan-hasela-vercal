import { useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import CustomerSelector from './CustomerSelector';
import { Button } from '@/components/ui/button';
import { customerErrorMessage } from '@/lib/customers';

export default function OrderCustomerLink({ order, onLinked }) {
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const inFlight = useRef(false);
  const link = async () => {
    if (inFlight.current || !selected) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const { data, error: failure } = await supabase.rpc('link_order_customer', { p_order_id: order.id, p_customer_id: selected.id, p_expected_version: order.customer_record_version ?? 0 });
      if (failure) throw failure;
      if (!data?.customer_snapshot_id) throw new Error('snapshot_missing');
      setSelected(null); setReviewing(false); onLinked(data);
    } catch (failure) { setError(customerErrorMessage(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <section className="space-y-3 text-card-foreground">
    {order.customer_snapshot_id && <><p className="rounded border p-3">פרטי החיוב ומדיניות המע״מ נשמרו להזמנה: {order.vat_applicable === true ? 'חייב במע״מ' : order.vat_applicable === false ? 'לא חייב במע״מ' : 'טרם נבדק'}. שינויים בכרטיס הלקוח אינם משנים את ההזמנה.</p>{order.payment_status === 'לא שולם' && !reviewing && <Button type="button" variant="outline" onClick={() => setReviewing(true)}>עדכון פרטי חיוב מהלקוח</Button>}</>}
    {(!order.customer_snapshot_id || reviewing) && <>
      <CustomerSelector value={selected?.id} onSelect={setSelected} initialValues={order} />
      <p className="text-sm">הקישור ישמור בהזמנה את פרטי החיוב ומדיניות המע״מ הנוכחיים. יש לבדוק את כרטיס הלקוח לפני האישור.</p>
      <Button type="button" disabled={busy || !selected || typeof selected.vat_applicable !== 'boolean'} onClick={link}>אישור לקוח ופרטי חיוב להזמנה</Button>
      {reviewing && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setReviewing(false); setSelected(null); }}>ביטול עדכון החיוב</Button>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
