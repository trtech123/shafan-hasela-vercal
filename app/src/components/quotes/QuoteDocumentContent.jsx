import moment from 'moment';
import { quotationLineTotal, quotationQuantity, quotationVatLabel } from '@/lib/quotations';

export default function QuoteDocumentContent({ quote, mode = 'quote' }) {
  const savedAt = quote.revision_created_at || quote.updated_at || quote.created_at;
  const isOrder = mode === 'order';
  return <article className="bg-white text-slate-800" dir="rtl" style={{ fontFamily:"'Heebo', Arial, sans-serif", width:794, padding:32, overflowWrap:'anywhere' }}>
    <header data-pdf-block className="flex justify-between items-center border-b border-blue-100 pb-5 mb-6">
      <div><h1 className="text-3xl font-bold">{isOrder ? 'תכולת ההזמנה מהצעת המחיר' : 'הצעת מחיר'}</h1><p className="text-slate-500 mt-1">{quote.order_number || quote.quote_number || '—'}</p></div>
      <div className="text-left"><p className="font-bold text-lg">שפן הסלע</p><p className="text-sm text-slate-500">ODT | מיצוב קבוצתי | ספורט אתגרי</p><p className="text-xs text-slate-500 mt-2">תאריך שמירה: {savedAt ? moment(savedAt).format('DD/MM/YYYY') : 'לא תועד'}</p></div>
    </header>
    <section data-pdf-block className="grid grid-cols-2 gap-4 mb-6">
      <div className="bg-slate-50 rounded-xl p-4"><h2 className="text-xs text-slate-500 mb-2">פרטי לקוח</h2><p className="font-bold text-lg">{quote.client_name}</p><p>{quote.organization}</p><p>{quote.client_phone}</p><p>{quote.client_email}</p></div>
      <div className="bg-slate-50 rounded-xl p-4"><h2 className="text-xs text-slate-500 mb-2">פרטי האירוע</h2>{quote.event_date && <p>{moment(quote.event_date).format('DD/MM/YYYY')}</p>}<p>{quote.site}</p>{quote.num_participants > 0 && <p>{quote.num_participants} משתתפים</p>}</div>
    </section>
    <section data-pdf-block className="mb-6 text-sm"><h2 className="font-semibold mb-1">פרטי חיוב</h2><p>{[quote.billing_institution_name,quote.billing_company_id].filter(Boolean).join(' · ')}</p><p>{quote.billing_accounting_email}</p><p>{[quote.billing_address_line,quote.billing_city,quote.billing_postal_code,quote.billing_country_code].filter(Boolean).join(', ')}</p><p className="mt-2">{quotationVatLabel(quote.vat_applicable)}</p></section>
    <section className="space-y-4"><h2 className="font-semibold">פעילויות ומוצרים</h2>
      {(quote.selected_activities || []).map((item,index) => <div key={index} data-pdf-block className="border border-slate-200 rounded-xl p-4">
        <div data-pdf-block className="flex justify-between gap-4"><div><h3 className="font-bold">{item.activity_name}</h3>{item.duration_hours > 0 && <p className="text-sm text-slate-500">{item.duration_hours} שעות</p>}<p className="text-sm text-slate-500">{quotationQuantity(item,quote)} × {Number(item.price_per_person || 0).toLocaleString()}₪</p></div><strong>{quotationLineTotal(item,quote).toLocaleString()}₪</strong></div>
        {item.description && <p data-pdf-block className="whitespace-pre-wrap text-sm leading-7 mt-2">{item.description}</p>}
        {(item.images?.length ? item.images : item.image_url ? [item.image_url] : []).map((src,imageIndex) => <img key={imageIndex} data-pdf-block src={src} alt={item.activity_name} crossOrigin="anonymous" className="mt-3 rounded-lg object-contain" style={{ width:'100%',maxHeight:240 }} />)}
      </div>)}
    </section>
    <section data-pdf-block className="border-t border-slate-200 mt-6 pt-4 text-left space-y-1">
      <p>סה״כ לפני הנחה: {Number(quote.total_price || 0).toLocaleString()}₪</p>{Number(quote.discount) > 0 && <p>הנחה: {Number(quote.discount).toLocaleString()}₪</p>}<p className="text-xl font-bold">סה״כ לתשלום: {Number(quote.final_price || 0).toLocaleString()}₪</p>
    </section>
    {quote.notes && <section className="bg-amber-50 rounded-xl p-4 mt-6"><h2 data-pdf-block className="font-semibold mb-1">הערות</h2><p data-pdf-block className="whitespace-pre-wrap text-sm leading-7">{quote.notes}</p></section>}
    <footer data-pdf-block className="border-t border-blue-100 mt-6 pt-4 text-center text-xs text-slate-500"><p>שפן הסלע — חוויות טבע ואתגר בגליל</p>{!isOrder && savedAt && <p>ההצעה בתוקף ל-14 יום מתאריך השמירה המופיע במסמך.</p>}</footer>
  </article>;
}
