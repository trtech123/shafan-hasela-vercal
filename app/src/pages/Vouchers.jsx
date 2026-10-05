import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { canManageCustomers } from '@/lib/customers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import VoucherForm from '@/components/vouchers/VoucherForm';
import SignaturePad from '@/components/vouchers/SignaturePad';
import { applyVoucherFilters, fetchVoucherReport, voucherReportError } from '@/lib/voucher-report';
import RegisterSettings from '@/components/vouchers/RegisterSettings';
import { validOrderId } from '@/payments/orderPayments';
import { boundedVoucherRequest, findOrderVoucher } from '@/lib/voucher-save';

export default function Vouchers() {
  const { user } = useAuth();
  const allowed = canManageCustomers(user?.role);
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [register, setRegister] = useState('');
  const [registers, setRegisters] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [creator, setCreator] = useState('');
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState(null);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [reportStatus, setReportStatus] = useState('');
  const [reportError, setReportError] = useState('');
  const exportController = useRef(null);
  useEffect(() => () => exportController.current?.abort(), []);
  const exportReport = async () => {
    if (!allowed || exportController.current) return;
    const controller = new AbortController(); exportController.current = controller;
    setExporting(true); setReportStatus(''); setReportError('');
    const generatedAt = new Date().toISOString();
    const filters = { search, register, dateFrom, dateTo, creator };
    let timeout;
    try {
      const operation = async () => {
        const reportRows = await fetchVoucherReport(supabase, filters, { cutoff: generatedAt, signal: controller.signal });
        if (controller.signal.aborted) throw new Error('report_timeout');
        const { downloadVoucherReport } = await import('@/components/vouchers/downloadVoucherReport');
        return downloadVoucherReport({ rows: reportRows, filters, generatedAt, registerLabel: registers.find(row => row.code === register)?.name }, { signal: controller.signal });
      };
      const result = await Promise.race([operation(), new Promise((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error('report_timeout')); }, 120_000);
      })]);
      setReportStatus(`הדו״ח הורד: ${result.count} שוברים, ${result.pages} עמודים. לא שונה מצב השוברים ולא נשלח אימייל.`);
    } catch (failure) { setReportError(voucherReportError(failure)); }
    finally { clearTimeout(timeout); exportController.current = null; setExporting(false); }
  };
  const orderId = params.get('orderId');
  const voucherId = params.get('voucherId');
  useEffect(() => {
    if (!allowed) return;
    let active = true; setLoading(true); setError('');
    const timer = setTimeout(async () => {
    try {
    const query = applyVoucherFilters(supabase.from('hakafa_vouchers').select('*', { count: 'exact' }).order('created_at', { ascending: false }).order('id'), {search, register, dateFrom, dateTo, creator});
    const { data, count: total, error: failure } = await query.range(page * 50, page * 50 + 49);
      if (!active) return;
      setLoading(false);
      if (failure) setError('לא ניתן לטעון שוברים.'); else { setRows(data || []); setCount(total || 0); }
    } catch (failure) { if (active) { setRows([]); setCount(0); setError(failure.message === 'invalid_date_range' ? voucherReportError(failure) : 'לא ניתן לטעון שוברים.'); setLoading(false); } }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [allowed, revision, search, register, dateFrom, dateTo, creator, page]);
  useEffect(() => { if (allowed) supabase.from('cash_registers').select('code,name').order('name').then(({ data }) => setRegisters(data || [])).catch(() => setError('לא ניתן לטעון קופות.')); }, [allowed, revision]);
  useEffect(() => {
    if (!allowed || !voucherId) return;
    if (!validOrderId(voucherId)) { setError('מזהה השובר אינו תקין.'); return; }
    let active = true;
    supabase.from('hakafa_vouchers').select('*').eq('id', voucherId).single().then(({ data, error: failure }) => {
      if (!active) return;
      if (failure || !data) setError('השובר לא נמצא או שאין הרשאה לצפות בו.'); else { setSelected(data); setNotice(`השובר ${data.voucher_number} שמור. מוצג העותק החתום.`); }
    }).catch(() => { if (active) setError('לא ניתן לטעון את השובר.'); });
    return () => { active = false; };
  }, [allowed, voucherId]);
  useEffect(() => {
    setOrder(null);
    setSelected(null); setNotice('');
    if (!allowed || !orderId) return;
    if (!validOrderId(orderId)) { setError('מזהה ההזמנה אינו תקין.'); return; }
    let active = true;
    (async () => {
      const existing = await findOrderVoucher(supabase, orderId);
      if (!active) return;
      if (existing) { setSelected(existing); setNotice(`כבר קיים שובר חתום להזמנה: ${existing.voucher_number}. מוצג השובר המקורי; לא נוצר שובר נוסף.`); return; }
      const { data, error: failure } = await boundedVoucherRequest(supabase.from('orders').select('*,activities(name)').eq('id', orderId).single());
      if (active) { if (failure) setError('לא ניתן לטעון את ההזמנה.'); else setOrder(data); }
    })().catch(() => { if (active) setError('לא ניתן לבדוק אם קיים שובר להזמנה. יש לרענן את המסך לפני יצירה.'); });
    return () => { active = false; };
  }, [orderId, allowed]);
  if (!allowed) return <p role="alert">אין הרשאה לצפות בשוברים.</p>;
  const filter = (setter) => (event) => { setter(event.target.value); setPage(0); };
  return <div dir="rtl" className="space-y-5 text-card-foreground">
    <h1 className="text-2xl font-bold">שוברי הקפה</h1>
    <p>שירותים שלא שולמו. ניתן להוריד דו״ח לפי הסינון שבחרתם. הדו״ח אינו אישור תשלום או מסמך חשבונאי ולא נשלח באימייל.</p>
    {user?.role === 'admin' && <RegisterSettings onSaved={() => setRevision((old) => old + 1)} />}
    {notice && <p role="status">{notice}</p>}
    {order && <VoucherForm key={order.id} order={order} onCancel={() => setParams({})} onSaved={(row) => { setOrder(null); setParams({ voucherId: row.id }); setRevision((old) => old + 1); }} />}
    {!orderId && <p className="text-sm">ליצירת שובר חדש יש לבחור ״שובר הקפה״ בהזמנה או בקופה לאחר קישור הזמנה.</p>}
    <div className="flex flex-wrap gap-3"><Input aria-label="חיפוש שוברים" placeholder="מספר שובר, לקוח, טלפון או שירות" value={search} onChange={filter(setSearch)} /><select aria-label="סינון קופה" className="rounded border p-2" value={register} onChange={filter(setRegister)}><option value="">כל הקופות</option>{registers.map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}</select><label>מתאריך<Input type="date" aria-label="מתאריך" value={dateFrom} onChange={filter(setDateFrom)} /></label><label>עד תאריך<Input type="date" aria-label="עד תאריך" value={dateTo} onChange={filter(setDateTo)} /></label><Input aria-label="שם יוצר השובר" placeholder="שם יוצר השובר" value={creator} onChange={filter(setCreator)} /><Button variant="outline" onClick={() => setRevision((old) => old + 1)}>רענון</Button></div>
    <section aria-label="דו״ח שוברי הקפה" className="flex flex-wrap items-center gap-3">
      <Button disabled={exporting || loading || Boolean(error)} onClick={exportReport}>{exporting ? 'מכין דו״ח...' : 'הורדת דו״ח'}</Button>
      <p className="text-sm">PDF בעברית · כל השוברים התואמים לסינון, מכל העמודים · עד 500 שוברים לדו״ח</p>
    </section>
    {reportStatus && <p role="status">{reportStatus}</p>}
    {reportError && <p role="alert">{reportError}</p>}
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">טוען שוברים...</p> : rows.length === 0 ? <p>לא נמצאו שוברים.</p> : <div className="grid gap-2">{rows.map((row) => <button className="rounded-lg border p-4 text-right" key={row.id} onClick={() => setSelected(row)}><strong>{row.voucher_number} — {row.billing_name || row.contact_name}</strong><span className="block text-sm">{new Date(row.created_at).toLocaleString('he-IL')} · {row.register_name || row.register_code} · {row.service_description}</span></button>)}</div>}
    <div className="flex gap-3 items-center"><Button variant="outline" disabled={loading || page === 0} onClick={() => setPage((old) => old - 1)}>הקודם</Button><p>עמוד {page + 1} · {count} שוברים תואמים</p><Button variant="outline" disabled={loading || (page + 1) * 50 >= count} onClick={() => setPage((old) => old + 1)}>הבא</Button></div>
    {selected && <article className="space-y-3 rounded-lg border p-4" aria-label="פרטי שובר">
      <h2 className="text-xl font-semibold">{selected.voucher_number}</h2><p>עותק קבוע כפי שנחתם בתאריך {new Date(selected.created_at).toLocaleString('he-IL')}</p>
      <p>הזמנה {selected.order_number} · קופה {selected.register_name || selected.register_code} · נוצר בידי {selected.creator_name || selected.created_by}</p><a className="underline" href={`/orders?orderId=${encodeURIComponent(selected.order_id)}`}>לפתיחת ההזמנה הקשורה</a>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[['order_id','הזמנה'],['register_code','קופה'],['billing_name','שם לחיוב'],['billing_company_id','ח.פ / ע.מ'],['billing_accounting_email','אימייל לחיוב'],['service_description','שירות'],['notes','הערות'],['contact_name','איש קשר'],['phone','טלפון'],['created_by','נוצר בידי'],['customer_version','גרסת כרטיס הלקוח']].map(([key,label]) => <div key={key}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{selected[key] || '—'}</dd></div>)}</dl>
      <p>מע״מ: {selected.vat_applicable === true ? 'חייב' : selected.vat_applicable === false ? 'לא חייב' : 'טרם נבדק'}</p>
      <SignaturePad readOnly value={selected.signature} />
      <Button variant="outline" onClick={() => setSelected(null)}>סגירת פרטים</Button>
    </article>}
  </div>;
}
