import { useRef, useState } from "react";
import moment from "moment";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import QuoteDeliveryPanel from './QuoteDeliveryPanel';

const statusLabels = {
  "טיוטה": { label: "טיוטה", color: "#94a3b8" },
  "נשלחה": { label: "נשלחה", color: "#3b82f6" },
  "ממתינה לאישור": { label: "ממתינה לאישור", color: "#f59e0b" },
  "אושרה": { label: "אושרה ✓", color: "#10b981" },
  "בוטלה": { label: "בוטלה", color: "#ef4444" },
};

const itemQuantity = (item, quote) => Number(item.quantity ?? quote.num_participants ?? 0);
const itemTotal = (item, quote) => Number(item.line_total ?? (Number(item.price_per_person || 0) * itemQuantity(item, quote)));

export default function QuotePDFDocument({ quote, mode = "quote", onClose }) {
  const docRef = useRef(null);
  const [deliveryBusy, setDeliveryBusy] = useState(false);

  const isOrder = mode === "order";
  const versionedDelivery = !isOrder && Boolean(quote.id);
  const title = isOrder ? "אישור הזמנה" : "הצעת מחיר";
  const docNumber = isOrder ? (quote.order_number || quote.quote_number) : quote.quote_number;

  const createPdf = async () => {
    const el = docRef.current;
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
    return pdf;
  };

  const handleDownloadPDF = async () => {
    const el = docRef.current;
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
    pdf.save(`${title}_${docNumber || "מסמך"}.pdf`);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex gap-2">
            <Button onClick={handleDownloadPDF} className="gap-2 bg-primary">
              <Download className="w-4 h-4" /> הורד PDF
            </Button>
          </div>
          <Button variant="ghost" size="icon" disabled={deliveryBusy} onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        {versionedDelivery && <QuoteDeliveryPanel quote={quote} createPdf={createPdf} onBusyChange={setDeliveryBusy} />}

        {/* Document */}
        <div ref={docRef} className="bg-white rounded-2xl shadow-2xl overflow-hidden font-sans" dir="rtl" style={{ fontFamily: "'Heebo', Arial, sans-serif" }}>
          {/* Header */}
          <div className="p-6 border-b border-blue-100" style={{ background: "rgba(59, 130, 246, 0.18)" }}>
            <div className="flex items-center justify-between">
              <img
                src="https://media.base44.com/images/public/69ca2dc3748aeb9c23109245/a0abe07c8_.jpg"
                alt="שפן הסלע"
                crossOrigin="anonymous"
                style={{ height: "64px", objectFit: "contain" }}
              />
              <div className="text-left">
                <div className="text-2xl font-bold text-slate-800">{title}</div>
                <div className="text-slate-500 text-sm mt-1">מספר: {docNumber || "—"}</div>
                <div className="text-slate-400 text-xs mt-0.5">תאריך הפקה: {moment().format("DD/MM/YYYY")}</div>
              </div>
            </div>
          </div>

          <div className="p-8 space-y-6">
            {/* Client info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-2">פרטי לקוח</p>
                <p className="font-bold text-lg">{quote.client_name}</p>
                {quote.organization && <p className="text-slate-600 text-sm">{quote.organization}</p>}
                <p className="text-slate-500 text-sm mt-1">{quote.client_phone}</p>
                {quote.client_email && <p className="text-slate-500 text-sm">{quote.client_email}</p>}
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-2">פרטי האירוע</p>
                {quote.event_date && <p className="font-semibold">{moment(quote.event_date).format("DD/MM/YYYY")}</p>}
                {quote.site && <p className="text-slate-600 text-sm">📍 {quote.site}</p>}
                {quote.num_participants && <p className="text-slate-600 text-sm">👥 {quote.num_participants} משתתפים</p>}
              </div>
            </div>

            {/* Activities */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase mb-3">פעילויות</p>
              <div className="space-y-3">
                {(quote.selected_activities || []).map((act, i) => (
                  <div key={i} className="flex items-center gap-4 border border-slate-100 rounded-xl p-4 bg-white">
                    <div className="flex-1">
                      <p className="font-semibold text-base">{act.activity_name}</p>
                      <p className="text-sm text-slate-500">
                        {act.duration_hours ? `⏱ ${act.duration_hours} שעות • ` : ""}{act.price_per_person}₪ {act.item_type === 'product' ? 'ליחידה' : 'לאדם'}
                      </p>
                      {act.description && <p className="text-sm text-slate-600 mt-1">{act.description}</p>}
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-lg">{itemTotal(act, quote).toLocaleString()}₪</p>
                      <p className="text-xs text-slate-400">{itemQuantity(act, quote)} × {act.price_per_person}₪</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Price summary */}
            <div className="border-t border-slate-100 pt-4">
              <div className="max-w-xs mr-auto space-y-2">
                {quote.discount > 0 && (
                  <>
                    <div className="flex justify-between text-sm text-slate-500">
                      <span>סה״כ לפני הנחה</span>
                      <span>{(quote.total_price || 0).toLocaleString()}₪</span>
                    </div>
                    <div className="flex justify-between text-sm text-red-500">
                      <span>הנחה</span>
                      <span>-{quote.discount.toLocaleString()}₪</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-bold text-xl border-t border-slate-200 pt-2">
                  <span>סה״כ לתשלום</span>
                  <span style={{ color: "#1a4a2e" }}>{(quote.final_price || 0).toLocaleString()}₪</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {quote.notes && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <p className="text-xs font-semibold text-amber-700 mb-1">הערות</p>
                <p className="text-sm text-slate-700">{quote.notes}</p>
              </div>
            )}

            {/* Activity images grid - quote only */}
            {!isOrder && (() => {
              // Collect up to 4 images from all selected activities (gallery first, fallback to image_url)
              const allImages = [];
              for (const act of (quote.selected_activities || [])) {
                const imgs = (act.images && act.images.length > 0) ? act.images : (act.image_url ? [act.image_url] : []);
                for (const img of imgs) {
                  if (allImages.length < 4) allImages.push({ src: img, label: act.activity_name });
                }
                if (allImages.length >= 4) break;
              }
              if (allImages.length === 0) return null;
              return (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase mb-3">גלריית פעילויות</p>
                  <div className="grid grid-cols-4 gap-2">
                    {allImages.map((img, i) => (
                      <div key={i} className="space-y-1">
                        <img
                          src={img.src}
                          alt={img.label}
                          crossOrigin="anonymous"
                          className="w-full h-24 object-cover rounded-lg"
                        />
                        <p className="text-xs text-center text-slate-500 truncate">{img.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Footer */}
            <div className="border-t border-blue-100 pt-4 text-center text-xs text-slate-400 space-y-1 rounded-b-2xl p-4" style={{ background: "rgba(59, 130, 246, 0.18)" }}>
              <p>שפן הסלע — ODT | מיצוב קבוצתי | ספורט אתגרי</p>
              {!isOrder && <p className="text-amber-600 font-medium">הצעת מחיר זו בתוקף ל-14 יום ממועד הפקתה</p>}
              {isOrder && <p className="text-emerald-600 font-medium">✓ ההזמנה אושרה — נתראה בשטח!</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
