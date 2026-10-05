import { useEffect, useId, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { customerDraft, customerPayload, customerErrorMessage, isPossibleDuplicate } from '@/lib/customers';
import BillingAddressFields from './BillingAddressFields';

const fields = [['display_name', 'שם לתצוגה'], ['contact_name', 'איש קשר'], ['phone', 'טלפון'], ['email', 'אימייל'], ['organization_name', 'שם ארגון'], ['billing_name', 'שם לחיוב'], ['billing_company_id', 'ח.פ / ע.מ'], ['billing_accounting_email', 'אימייל להנהלת חשבונות']];

export default function CustomerFormDialog({ customer = null, initialValues = {}, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => customerDraft(customer || initialValues));
  const [createId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState([]);
  const [duplicateError, setDuplicateError] = useState(false);
  const id = useId();
  useEffect(() => {
    let active = true;
    const terms = [...new Set([draft.phone, draft.email, draft.billing_company_id, draft.display_name, draft.organization_name].filter(Boolean))];
    setDuplicates([]); setDuplicateError(false);
    if (!terms.length) return;
    const timer = setTimeout(async () => {
      try {
        const results = await Promise.all(terms.map((term) => supabase.rpc('search_customers', { p_search: term, p_include_archived: false })));
        if (results.some((result) => result.error)) throw new Error('search_failed');
        const candidates = [...new Map(results.flatMap((result) => result.data || []).map((row) => [row.id, row])).values()];
        if (active) setDuplicates(candidates.filter((row) => row.id !== customer?.id && isPossibleDuplicate(draft, row)));
      } catch { if (active) setDuplicateError(true); }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [draft.phone, draft.email, draft.billing_company_id, draft.display_name, draft.organization_name, customer?.id]);
  const change = (field, value) => setDraft((previous) => ({ ...previous, [field]: value }));
  const save = async (event) => {
    event.preventDefault(); event.stopPropagation();
    if (saveInFlight.current) return;
    if (!draft.display_name.trim()) { setError('יש להזין שם לתצוגה.'); return; }
    if (typeof draft.vat_applicable !== 'boolean') { setError('יש לבחור במפורש האם הלקוח חייב במע״מ.'); return; }
    saveInFlight.current = true;
    setSaving(true); setError('');
    try {
      const { data, error: saveError } = await supabase.rpc('save_customer', { p_data: customerPayload(draft), p_id: customer?.id || createId, p_expected_version: customer?.version ?? null });
      if (saveError) throw saveError;
      const saved = Array.isArray(data) ? data[0] : data;
      if (!saved?.id) throw new Error('customer_save_empty');
      onSaved(saved);
    } catch (saveError) { setError(customerErrorMessage(saveError)); }
    finally { saveInFlight.current = false; setSaving(false); }
  };
  const close = () => { if (!saveInFlight.current) onClose(); };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl text-card-foreground" onClick={(event) => event.stopPropagation()}>
      <DialogTitle>{customer ? 'עריכת כרטיס לקוח' : 'לקוח חדש'}</DialogTitle>
      <DialogDescription>פרטי הכרטיס ישמשו כברירת מחדל בבחירת הלקוח. עריכת כרטיס אינה משנה הזמנות או הצעות קיימות.</DialogDescription>
      <form onSubmit={save} className="space-y-4">
        <label className="block text-sm space-y-1">סוג לקוח
          <select className="block w-full rounded-md border p-2 bg-background" value={draft.customer_kind} onChange={(event) => change('customer_kind', event.target.value)}><option value="person">אדם פרטי</option><option value="organization">ארגון</option></select>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{fields.map(([field, label]) => <div className="space-y-1" key={field}>
          <label htmlFor={`${id}-${field}`} className="text-sm">{label}</label>
          <Input id={`${id}-${field}`} type={field === 'email' || field === 'billing_accounting_email' ? 'email' : 'text'} value={draft[field]} required={field === 'display_name'} onChange={(event) => change(field, event.target.value)} />
        </div>)}</div>
        <BillingAddressFields value={draft} onChange={change} />
        <label className="block text-sm space-y-1">מדיניות מע״מ
          <select aria-label="מדיניות מע״מ" required className="block w-full rounded-md border p-2 bg-background" value={draft.vat_applicable === null ? '' : String(draft.vat_applicable)} onChange={(event) => change('vat_applicable', event.target.value === '' ? null : event.target.value === 'true')}>
            <option value="">יש לבחור במפורש</option><option value="true">חייב במע״מ</option><option value="false">לא חייב במע״מ</option>
          </select>
        </label>
        {duplicates.length > 0 && <div role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">נמצאו כרטיסים דומים: {duplicates.map((row) => row.display_name).join(', ')}. אפשר לשמור כרטיס נפרד; לא יתבצע מיזוג.</div>}
        {duplicateError && <p className="text-sm text-amber-800">לא ניתן לבדוק כרטיסים דומים כרגע. אפשר לשמור ולהשוות בהמשך.</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? 'שומר...' : 'שמירת כרטיס לקוח'}</Button><Button type="button" variant="outline" disabled={saving} onClick={close}>ביטול</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
