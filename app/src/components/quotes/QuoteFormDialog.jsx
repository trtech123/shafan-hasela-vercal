import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import CustomerSelector from '@/components/customers/CustomerSelector';
import { customerToRecord } from '@/lib/customers';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { boundedQuotationOperation, canManageQuotations, quotationError, quotationPayload, quotationQuantity, quotationTotals, quotationVatLabel } from '@/lib/quotations';

const SITES = ['עכו','טבריה','נוף הגליל','שטח','פודטראק','קפה אקסטרים'];
const EMPTY = { client_name:'',client_phone:'',client_email:'',organization:'',event_date:'',site:'',num_participants:'',notes:'',selected_activities:[],discount:'',status:'טיוטה',billing_institution_name:'',billing_company_id:'',billing_accounting_email:'',billing_address_line:'',billing_city:'',billing_postal_code:'',billing_country_code:'' };
const CONTACT = [['client_name','שם הלקוח'],['client_phone','טלפון'],['client_email','אימייל'],['organization','ארגון / חברה']];
const BILLING = [['billing_institution_name','שם לחיוב'],['billing_company_id','ח.פ / ע.מ'],['billing_accounting_email','אימייל הנהלת חשבונות'],['billing_address_line','כתובת לחיוב'],['billing_city','עיר'],['billing_postal_code','מיקוד'],['billing_country_code','קוד מדינה']];
const itemKey = item => (item.item_type || (item.product_id ? 'product' : 'activity')) + ':' + (item.product_id || item.activity_id);

export default function QuoteFormDialog({ open, onClose, quote, onSaved, prefill }) {
  const { user } = useAuth();
  const allowed = canManageQuotations(user?.role);
  const [form, setForm] = useState(EMPTY);
  const [catalog, setCatalog] = useState([]);
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [vat, setVat] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const busy = useRef(false);
  const pending = useRef(null);
  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY, ...quotationPayload(quote || prefill || EMPTY) });
    setCustomer(quote?.customer_id ? { id: quote.customer_id, version: quote.customer_version } : null);
    setVat(quote?.vat_applicable ?? null); setRefresh(false); setReviewing(false); setSearch(''); setError(''); setUncertain(false); pending.current = null;
  }, [open, quote, prefill]);
  useEffect(() => {
    if (!open || !allowed) return;
    let active = true; setCatalog([]); setCatalogError('');
    boundedQuotationOperation(() => Promise.all([
      supabase.from('activities').select('*').eq('status','פעיל'),
      supabase.from('products').select('*').eq('status','פעיל'),
    ])).then(([activities, products]) => {
      if (!active) return;
      if (activities.error || products.error) setCatalogError('לא ניתן לטעון חלק מהקטלוג. הפריטים שנשמרו בהצעה עדיין זמינים.');
      setCatalog([
        ...(activities.data || []).map(row => ({ ...row, item_type:'activity', activity_id:row.id, product_id:null })),
        ...(products.data || []).map(row => ({ ...row, item_type:'product', product_id:row.id, activity_id:null, price_per_person:Number(row.price || 0), duration_hours:null, images:row.image_url ? [row.image_url] : [] })),
      ]);
    }).catch(() => { if (active) setCatalogError('טעינת הקטלוג לא הושלמה. ניתן להמשיך עם הפריטים השמורים.'); });
    return () => { active = false; };
  }, [open, allowed]);
  const change = (key, value) => setForm(old => ({ ...old, [key]:value }));
  const selectCustomer = row => {
    const details = customerToRecord(row);
    delete details.customer_id;
    setCustomer({ id:row.id, version:row.version }); setVat(row.vat_applicable); setRefresh(true);
    setForm(old => ({ ...old, ...details, billing_institution_name:row.billing_name || row.display_name || '' }));
  };
  const addItem = row => {
    if (form.selected_activities.some(item => itemKey(item) === itemKey(row))) return;
    change('selected_activities', [...form.selected_activities, { item_type:row.item_type,activity_id:row.activity_id,product_id:row.product_id,activity_name:row.name,price_per_person:Number(row.price_per_person || 0),quantity:Number(form.num_participants) || 1,description:row.description || '',image_url:row.image_url || '',images:row.images || [],duration_hours:row.duration_hours ?? null,site:row.site || null }]);
  };
  const editItem = (index, key, value) => change('selected_activities', form.selected_activities.map((item, i) => i === index ? { ...item, [key]:value } : item));
  const submit = async event => {
    event.preventDefault();
    if (!allowed || busy.current) return;
    if (!pending.current && (!form.selected_activities.length || form.selected_activities.some(item => !(quotationQuantity(item,form) > 0) || Number(item.price_per_person) < 0) || quotationTotals(form).final < 0)) {
      setError('בחרו לפחות פריט אחד ובדקו כמויות, מחירים והנחה.'); return;
    }
    busy.current = true; setSaving(true); setError('');
    pending.current ??= { p_request_id:crypto.randomUUID(),p_quote_id:quote?.id || null,p_expected_version:quote?.quotation_version ?? 0,p_data:quotationPayload(form),p_customer_id:customer?.id || null,p_customer_version:customer?.version ?? null,p_refresh_customer:refresh };
    try {
      const { data, error: failure } = await boundedQuotationOperation(() => supabase.rpc('save_quotation',pending.current));
      if (failure) {
        if (/^(PT409|[0-9A-Z]{5})$/.test(failure.code || '')) { pending.current = null; setUncertain(false); }
        else setUncertain(true);
        setError(quotationError(failure)); return;
      }
      if (!data?.id) throw new Error('unknown_save_result');
      pending.current = null; setUncertain(false); onSaved(data); onClose();
    } catch {
      setUncertain(true); setError('תוצאת השמירה אינה ידועה. לא נשלחה בקשה נוספת. ניתן לבדוק שוב את אותה בקשה.');
    } finally { busy.current = false; setSaving(false); }
  };
  const totals = quotationTotals(form);
  if (!allowed) return open ? <p role="alert">אין הרשאה לניהול הצעות מחיר.</p> : null;
  return <Dialog open={open} onOpenChange={() => { if (!saving && !uncertain) onClose(); }}>
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{quote ? 'עריכת הצעת מחיר' : 'הצעת מחיר חדשה'}</DialogTitle></DialogHeader>
      <fieldset disabled={saving || uncertain} className="space-y-3">
        {quote?.customer_id && !reviewing ? <div className="rounded-lg border p-3"><p>פרטי הלקוח נשמרו בהצעה. עדכון כרטיס הלקוח אינו משנה אותם.</p><Button type="button" variant="outline" onClick={() => setReviewing(true)}>עדכון פרטי הלקוח מהכרטיס</Button></div> : <CustomerSelector value={customer?.id} onSelect={selectCustomer} onClear={() => { setCustomer(null); setVat(null); setRefresh(false); }} initialValues={form} />}
        <p role="status" className="text-sm">{quotationVatLabel(vat)}{refresh && ' · פרטי הכרטיס נבחרו מחדש להצעה'}</p>
      </fieldset>
      <form onSubmit={submit} className="space-y-5">
        <fieldset disabled={saving || uncertain} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CONTACT.map(([key,label]) => <div key={key}><Label htmlFor={'quote-'+key}>{label}</Label><Input id={'quote-'+key} type={key === 'client_email' ? 'email' : 'text'} value={form[key] ?? ''} required={key === 'client_name' || key === 'client_phone'} onChange={event => change(key,event.target.value)} /></div>)}
            <div><Label htmlFor="quote-event-date">תאריך אירוע מוצע</Label><Input id="quote-event-date" type="date" value={form.event_date || ''} onChange={event => change('event_date',event.target.value)} /></div>
            <div><Label htmlFor="quote-site">אתר</Label><select id="quote-site" className="w-full rounded-md border p-2 bg-background" value={form.site || ''} onChange={event => change('site',event.target.value)}><option value="">בחר אתר</option>{SITES.map(site => <option key={site}>{site}</option>)}</select></div>
            <div><Label htmlFor="quote-participants">מספר משתתפים</Label><Input id="quote-participants" type="number" min="1" value={form.num_participants ?? ''} onChange={event => change('num_participants',event.target.value)} /></div>
          </div>
          <details><summary className="cursor-pointer font-medium">פרטי חיוב להצעה</summary><p className="text-xs text-muted-foreground my-2">ניתן להתאים את הפרטים להצעה בלי לשנות את כרטיס הלקוח.</p><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{BILLING.map(([key,label]) => <div key={key}><Label htmlFor={'quote-'+key}>{label}</Label><Input id={'quote-'+key} value={form[key] ?? ''} onChange={event => change(key,event.target.value)} /></div>)}</div></details>
          <section aria-label="פריטים שנבחרו" className="space-y-3"><h3 className="font-semibold">פריטים בהצעה</h3>
            {form.selected_activities.map((item,index) => <div key={index} className="rounded-lg border p-3 space-y-2"><div className="flex justify-between gap-2"><p className="font-medium">{item.activity_name}</p><Button type="button" variant="ghost" size="sm" aria-label={'הסרת '+item.activity_name} onClick={() => change('selected_activities',form.selected_activities.filter((_,i) => i !== index))}>הסרה</Button></div>
              <p className="text-sm whitespace-pre-wrap">{item.description}</p><div className="grid grid-cols-2 gap-3"><div><Label htmlFor={'quote-quantity-'+index}>כמות</Label><Input id={'quote-quantity-'+index} aria-label={'כמות '+item.activity_name} type="number" min="0.001" step="0.001" value={quotationQuantity(item,form)} onChange={event => editItem(index,'quantity',Number(event.target.value))} /></div><div><Label htmlFor={'quote-price-'+index}>מחיר ליחידה (₪)</Label><Input id={'quote-price-'+index} aria-label={'מחיר '+item.activity_name} type="number" min="0" step="0.01" value={item.price_per_person} onChange={event => editItem(index,'price_per_person',Number(event.target.value))} /></div></div>
            </div>)}
          </section>
          <section className="space-y-2"><Label htmlFor="quote-catalog-search">חיפוש פעילויות ומוצרים</Label><Input id="quote-catalog-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="שם פעילות, מוצר או תיאור" />
            {catalogError && <p role="alert">{catalogError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">{catalog.filter(item => (item.name+' '+(item.description || '')).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(item => {
              const selected = form.selected_activities.some(row => itemKey(row) === itemKey(item));
              return <button key={itemKey(item)} type="button" disabled={selected} onClick={() => addItem(item)} className={'border rounded-lg p-3 text-right '+(selected ? 'border-primary bg-primary/5' : 'hover:bg-muted')}><strong>{item.name}</strong><span className="block text-sm">{item.price_per_person}₪ ליחידה{selected ? ' · נבחר' : ''}</span></button>;
            })}</div>
          </section>
          <div className="rounded-lg bg-muted/50 p-4 space-y-2"><p>סה״כ לפני הנחה: {totals.gross.toLocaleString()}₪</p><Label htmlFor="quote-discount">הנחה (₪)</Label><Input id="quote-discount" type="number" min="0" step="0.01" max={totals.gross} value={form.discount} onChange={event => change('discount',event.target.value)} /><p className="font-bold">מחיר סופי: {totals.final.toLocaleString()}₪</p></div>
          <div><Label htmlFor="quote-notes">הערות</Label><Textarea id="quote-notes" rows={4} value={form.notes || ''} onChange={event => change('notes',event.target.value)} /></div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3"><Button type="button" variant="outline" disabled={saving || uncertain} onClick={onClose}>ביטול</Button><Button type="submit" disabled={saving}>{saving ? 'שומר...' : uncertain ? 'בדיקת תוצאת השמירה' : quote ? 'עדכון' : 'צור הצעה'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
