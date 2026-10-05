import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { boundedQuotationOperation, canManageQuotations, quotationError } from '@/lib/quotations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, FileText, Eye, CheckCircle2, Trash2 } from 'lucide-react';
import moment from 'moment';
import QuoteFormDialog from '@/components/quotes/QuoteFormDialog';
import QuotePDFDocument from '@/components/quotes/QuotePDFDocument';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export default function Quotes() {
  const { user } = useAuth();
  const allowed = canManageQuotations(user?.role);
  const [quotes,setQuotes] = useState([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [search,setSearch] = useState('');
  const [dialogOpen,setDialogOpen] = useState(false);
  const [editingQuote,setEditingQuote] = useState(null);
  const [preview,setPreview] = useState(null);
  const [deleteId,setDeleteId] = useState(null);
  const [busy,setBusy] = useState(null);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true); setError('');
    try {
      const {data,error:failure} = await boundedQuotationOperation(() => supabase.from('quotes').select('*').order('created_at',{ascending:false}).limit(100));
      if (failure) throw failure;
      setQuotes(data || []);
    } catch { setError('לא ניתן לטעון הצעות כרגע. נסו לרענן את הרשימה.'); }
    finally { setLoading(false); }
  },[allowed]);
  useEffect(() => { load(); },[load]);
  const edit = quote => { setEditingQuote(quote); setDialogOpen(true); };
  const viewQuote = async quote => {
    if (inFlight.current) return;
    if (!quote.quotation_revision_id) { setPreview({quote,mode:'quote'}); return; }
    inFlight.current = true; setBusy(quote.id); setError('');
    try {
      const {data,error:failure} = await boundedQuotationOperation(() => supabase.from('quotation_revisions').select('data,captured_at').eq('quote_id',quote.id).eq('id',quote.quotation_revision_id).single());
      if (failure || !data?.data) throw failure || new Error('quotation_revision_missing');
      setPreview({mode:'quote',quote:{...data.data,revision_created_at:data.captured_at}});
    } catch { setError('לא ניתן לטעון את הגרסה השמורה של ההצעה.'); }
    finally { inFlight.current = false; setBusy(null); }
  };
  const showOrder = order => {
    if (!order?.quotation_snapshot) throw new Error('quotation_snapshot_missing');
    setPreview({mode:'order',quote:{...order.quotation_snapshot,order_number:order.order_number}});
  };
  const convert = async quote => {
    if (inFlight.current || !allowed) return;
    inFlight.current = true; setBusy(quote.id); setError('');
    try {
      const {data,error:failure} = await boundedQuotationOperation(() => supabase.rpc('convert_quotation_to_order',{p_quote_id:quote.id,p_expected_version:quote.quotation_version}));
      if (failure) throw failure;
      showOrder(data);
      setQuotes(rows => rows.map(row => row.id === quote.id ? {...row,converted_to_order_id:data.id,status:'אושרה'} : row));
    } catch (failure) {
      setError(failure.code === 'quotation_timeout' ? 'תוצאת ההמרה אינה ידועה. רעננו את הרשימה לפני המשך; לא נשלחה בקשה נוספת.' : quotationError(failure));
    } finally { inFlight.current = false; setBusy(null); }
  };
  const viewOrder = async quote => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(quote.id); setError('');
    try {
      const {data,error:failure} = await boundedQuotationOperation(() => supabase.from('orders').select('id,order_number,quotation_snapshot').eq('id',quote.converted_to_order_id).single());
      if (failure) throw failure;
      showOrder(data);
    } catch { setError('לא ניתן לטעון את התכולה השמורה של ההזמנה.'); }
    finally { inFlight.current = false; setBusy(null); }
  };
  const remove = async () => {
    if (inFlight.current || user?.role !== 'admin') return;
    inFlight.current = true; setBusy(deleteId);
    try {
      const {error:failure} = await boundedQuotationOperation(() => supabase.from('quotes').delete().eq('id',deleteId));
      if (failure) throw failure;
      setQuotes(rows => rows.filter(row => row.id !== deleteId));
    } catch { setError('לא ניתן למחוק את ההצעה. גרסאות שמורות נשמרות כהיסטוריה.'); }
    finally { inFlight.current = false; setBusy(null); setDeleteId(null); }
  };
  if (!allowed) return <p role="alert">אין הרשאה לניהול הצעות מחיר.</p>;
  const term=search.trim().toLocaleLowerCase();
  const filtered=quotes.filter(quote => [quote.client_name,quote.organization,quote.quote_number,quote.client_phone,quote.client_email].some(value => String(value || '').toLocaleLowerCase().includes(term)));
  return <div className="space-y-6" dir="rtl">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h1 className="text-3xl font-bold tracking-tight">הצעות מחיר</h1><p className="text-muted-foreground mt-1">הצעות, מסמכים והמרה להזמנה</p></div><Button onClick={() => edit(null)} className="gap-2"><Plus className="w-4 h-4"/>הצעה חדשה</Button></div>
    <div className="flex gap-3"><div className="relative max-w-sm flex-1"><Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/><Input aria-label="חיפוש הצעות מחיר" placeholder="שם, ארגון, מספר הצעה או טלפון" className="pr-9" value={search} onChange={event => setSearch(event.target.value)}/></div><Button variant="outline" onClick={load} disabled={loading || Boolean(busy)}>רענון</Button></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {loading ? <p role="status">טוען הצעות...</p> : filtered.length === 0 ? <div className="bg-card rounded-2xl border p-12 text-center"><FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30"/><p>{search ? 'לא נמצאו הצעות מתאימות' : 'עדיין אין הצעות מחיר'}</p></div> : <div className="space-y-3">{filtered.map(quote => <article key={quote.id} className="bg-card rounded-2xl border border-border shadow-sm p-5">
      <div className="flex justify-between gap-4"><div><div className="flex gap-3 mb-1"><span className="text-xs font-mono text-muted-foreground">{quote.quote_number}</span><span className="text-xs rounded-full border px-2 bg-muted">{quote.status}</span></div><h2 className="font-bold text-lg">{quote.client_name}</h2>{quote.organization && <p className="text-sm text-muted-foreground">{quote.organization}</p>}<p className="text-xs text-muted-foreground mt-2">{[quote.event_date && moment(quote.event_date).format('DD/MM/YYYY'),quote.site,(quote.selected_activities || []).length+' פריטים'].filter(Boolean).join(' · ')}</p></div><p className="text-2xl font-bold text-primary">{Number(quote.final_price || 0).toLocaleString()}₪</p></div>
      <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => viewQuote(quote)}><Eye className="w-3.5 h-3.5"/>צפה / שלח</Button>
        {!quote.converted_to_order_id && <Button size="sm" variant="outline" onClick={() => edit(quote)}>עריכה</Button>}
        {!quote.converted_to_order_id && quote.status !== 'בוטלה' && quote.quotation_revision_id && <Button size="sm" disabled={Boolean(busy)} onClick={() => convert(quote)}><CheckCircle2 className="w-3.5 h-3.5"/>{busy === quote.id ? 'ממיר...' : 'הפוך להזמנה'}</Button>}
        {!quote.quotation_revision_id && !quote.converted_to_order_id && <span className="text-xs text-muted-foreground self-center">יש לשמור גרסה של ההצעה לפני המרה או שליחה.</span>}
        {quote.converted_to_order_id && <>{quote.quotation_revision_id && <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => viewOrder(quote)}>תכולת ההזמנה שנשמרה</Button>}<a className="text-sm text-primary underline self-center" href={'/orders?orderId='+encodeURIComponent(quote.converted_to_order_id)}>פתיחת ההזמנה</a></>}
        {user?.role === 'admin' && !quote.quotation_revision_id && !quote.converted_to_order_id && <Button size="sm" variant="ghost" aria-label="מחיקת הצעה" onClick={() => setDeleteId(quote.id)}><Trash2 className="w-3.5 h-3.5"/></Button>}
      </div>{quote.quotation_revision_id && <p className="text-xs text-muted-foreground mt-2">גרסה {quote.quotation_version} נשמרה כהיסטוריה ולא ניתנת למחיקה.</p>}
    </article>)}</div>}
    <QuoteFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} quote={editingQuote} onSaved={saved => setQuotes(rows => [saved,...rows.filter(row => row.id !== saved.id)])}/>
    {preview && <QuotePDFDocument quote={preview.quote} mode={preview.mode} onClose={() => setPreview(null)}/>}
    <AlertDialog open={Boolean(deleteId)} onOpenChange={() => setDeleteId(null)}><AlertDialogContent dir="rtl"><AlertDialogHeader><AlertDialogTitle>מחיקת הצעת מחיר</AlertDialogTitle><AlertDialogDescription>למחוק את ההצעה הישנה? פעולה זו אינה הפיכה.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>ביטול</AlertDialogCancel><AlertDialogAction disabled={Boolean(busy)} onClick={remove}>מחק</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
