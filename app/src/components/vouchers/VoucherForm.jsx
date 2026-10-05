import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import OrderCustomerLink from '@/components/customers/OrderCustomerLink';
import SignaturePad from './SignaturePad';
import { findOrderVoucher, saveVoucher } from '@/lib/voucher-save';
import { emptySignature, voucherError, voucherDraftFromOrder, voucherMissingFields, voucherRegisterFromOrder } from '@/lib/vouchers';

export default function VoucherForm({ order: initialOrder, onSaved, onCancel }) {
  const [order, setOrder] = useState(initialOrder);
  const [registers, setRegisters] = useState([]);
  const [register, setRegister] = useState('');
  const [signature, setSignature] = useState(emptySignature);
  const [draft, setDraft] = useState(() => voucherDraftFromOrder(initialOrder));
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const request = useRef(null);
  const [uncertain, setUncertain] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    supabase.from('cash_registers').select('code,name').eq('active', true).order('name').then(({ data, error: failure }) => {
      if (!active) return;
      if (failure) setError('לא ניתן לטעון קופות. יש לפתוח את המסך מחדש.');
      else { setRegisters(data || []); setRegister(voucherRegisterFromOrder(initialOrder, data || [])); }
    }).catch(() => { if (active) setError('לא ניתן לטעון קופות. יש לפתוח את המסך מחדש.'); });
    return () => { active = false; };
  }, [initialOrder]);
  const missing = voucherMissingFields({ order, register, draft, signature });
  const save = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (missing.length) { setError(`נדרש להשלים: ${missing.join(', ')}.`); return; }
    inFlight.current = true; setBusy(true); setError('');
    // Keep the exact payload after an uncertain response; retry the same durable request.
    request.current ||= { p_id: id, p_data: { order_id: order.id, customer_snapshot_id: order.customer_snapshot_id, register_code: register, ...draft, signature } };
    try {
      const data = uncertain
        ? await findOrderVoucher(supabase, order.id)
        : await saveVoucher(supabase, request.current);
      if (!data?.id) throw new Error('voucher_outcome_unknown');
      if (mounted.current) onSaved(data);
    } catch (failure) {
      if (mounted.current) { setUncertain(true); setError(voucherError(failure)); }
    }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="space-y-4 rounded-lg border bg-card text-card-foreground p-4" aria-label="יצירת שובר הקפה">
    <h2 className="text-xl font-semibold">שובר הקפה להזמנה {order.order_number}</h2>
    <p>תיעוד שירות שלא שולם. יצירת שובר אינה רושמת תשלום או מכירה.</p>
    <p className="text-sm text-muted-foreground">פרטי השירות והקשר הועתקו מההזמנה. תאריך ושעת היצירה, המשתמש ותפקידו יישמרו אוטומטית בעת השמירה. שינוי פרטים מחייב חתימה מחדש.</p>
    <fieldset disabled={busy || Boolean(request.current)}><OrderCustomerLink order={order} onLinked={(row) => { setOrder({ ...order, ...row }); setDraft((old) => ({ ...old, contact_name: row.client_name || '', phone: row.client_phone || '' })); setSignature(emptySignature()); }} /></fieldset>
    {order.customer_snapshot_id && <p>פרטי חיוב שמורים: {order.billing_institution_name} · {order.billing_company_id} · {order.billing_accounting_email}</p>}
    <form onSubmit={save} className="space-y-4">
      <fieldset disabled={busy || Boolean(request.current)} className="space-y-4">
        <label className="block">קופה<select aria-label="קופה לשובר" required value={register} onChange={(event) => { setRegister(event.target.value); setSignature(emptySignature()); }} className="block w-full border rounded p-2"><option value="">בחירת קופה</option>{registers.map((row) => <option key={row.code} value={row.code}>{row.name} ({row.code})</option>)}</select></label>
        {!register && <p className="text-sm text-muted-foreground">לא שמורה בהזמנה קופה מזוהה. יש לבחור את הקופה המתאימה; אתר הפעילות אינו קובע אותה אוטומטית.</p>}
        {[['service_description', 'תיאור השירות'], ['notes', 'הערות'], ['contact_name', 'איש קשר'], ['phone', 'טלפון']].map(([field, label]) => <label className="block" key={field}>{label}<Input aria-label={label} required={field !== 'notes'} maxLength={field === 'phone' ? 80 : field === 'contact_name' ? 300 : field === 'notes' ? 4000 : 2000} value={draft[field]} onChange={(event) => { setDraft((old) => ({ ...old, [field]: event.target.value })); setSignature(emptySignature()); }} /></label>)}
        <SignaturePad value={signature} onChange={setSignature} disabled={busy || Boolean(request.current)} />
      </fieldset>
      {request.current && error && <p>פרטי הבקשה נשמרו במסך. בדיקת התוצאה קוראת את השובר הקיים בלבד ואינה שולחת בקשת יצירה נוספת.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div role="status" aria-live="polite" className="rounded border p-3 text-sm">{busy ? 'בודק ושומר את השובר. במקרה של עיכוב תתבצע בדיקת תוצאה ללא יצירה נוספת.' : uncertain ? 'תוצאת השמירה טרם אומתה. יש לבדוק את התוצאה לפני ניסיון חדש.' : missing.length ? <>לפני השמירה יש להשלים:<ul className="list-disc pr-5">{missing.map((field) => <li key={field}>{field}</li>)}</ul></> : 'הפרטים והחתימה הושלמו. ניתן לשמור את השובר.'}</div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || missing.length > 0} type="submit">{busy ? 'שומר...' : uncertain ? 'בדיקת תוצאת השמירה' : 'שמירת שובר חתום'}</Button><Button variant="outline" type="button" disabled={busy} onClick={onCancel}>סגירה</Button></div>
    </form>
  </section>;
}
