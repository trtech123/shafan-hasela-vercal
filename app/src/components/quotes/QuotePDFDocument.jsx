import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { boundedQuotationOperation } from '@/lib/quotations';
import { buildQuotePdf } from './quotePdf';
import QuoteDocumentContent from './QuoteDocumentContent';
import QuoteDeliveryPanel from './QuoteDeliveryPanel';

export default function QuotePDFDocument({ quote, mode = 'quote', onClose }) {
  const docRef = useRef(null);
  const inFlight = useRef(false);
  const [downloading,setDownloading] = useState(false);
  const [sending,setSending] = useState(false);
  const [error,setError] = useState('');
  const createPdf = () => boundedQuotationOperation(signal => buildQuotePdf(docRef.current,{signal}),45000);
  const download = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setDownloading(true); setError('');
    try { const pdf = await createPdf(); pdf.save((mode === 'order' ? 'תכולת הזמנה_' : 'הצעת מחיר_')+(quote.order_number || quote.quote_number || 'מסמך')+'.pdf'); }
    catch { setError('יצירת ה-PDF לא הושלמה. נסו שוב.'); }
    finally { inFlight.current = false; setDownloading(false); }
  };
  return <Dialog open onOpenChange={() => { if (!downloading && !sending) onClose(); }}><DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto" dir="rtl" aria-describedby={undefined}>
    <DialogHeader><DialogTitle>{mode === 'order' ? 'תכולת ההזמנה מההצעה' : 'תצוגה ושליחת הצעת מחיר'}</DialogTitle></DialogHeader>
    <div className="flex gap-2"><Button onClick={download} disabled={downloading || sending}>{downloading ? 'מכין PDF...' : 'הורד PDF'}</Button><Button variant="outline" disabled={downloading || sending} onClick={onClose}>סגירה</Button></div>
    {error && <p role="alert">{error}</p>}
    {mode === 'quote' && quote.id ? <QuoteDeliveryPanel key={quote.quotation_revision_id || quote.id} quote={quote} createPdf={createPdf} onBusyChange={setSending} /> : mode === 'quote' ? <p className="text-sm">יש לשמור את ההצעה כגרסה חדשה לפני שליחה.</p> : <p className="text-sm">תכולה שנשמרה בעת ההמרה. אישור ההזמנה ופעולות התשלום זמינים במסך ההזמנות.</p>}
    <div className="overflow-x-auto rounded-lg border bg-slate-100"><div ref={docRef}><QuoteDocumentContent quote={quote} mode={mode} /></div></div>
  </DialogContent></Dialog>;
}
