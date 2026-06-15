import { useRef, useState } from "react";
import moment from "moment";
import { Button } from "@/components/ui/button";
import { Download, MessageCircle, Mail, X, Loader2 } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import {
  BRAND,
  ORDER_TERMS_INTRO,
  ORDER_TERMS,
  ORDER_TERMS_RETURN,
  SIGNATURE_BLOCK,
  VAT_NOTE,
  MOBILE_CONTACT,
  SAFETY_TITLE,
  SAFETY_GROUP_FIELD,
  SAFETY_RULES,
  SAFETY_DECLARATION,
  SAFETY_SIGNATURE,
  SAFETY_MINORS_HEADER,
  SAFETY_MINORS_TEXT,
  SAFETY_CONTACT,
} from "@/lib/orderDocText";

// Combined customer-facing order-confirmation PDF.
//   Section A — order confirmation (quote-PDF design) + fixed order terms + signature block.
//   Section B — safety / health declaration.
// One overlay, one [הורד PDF] button → ONE combined PDF (2 pages: A then B).
// No email send, no digital signature, no DB tracking. Single-activity per
// order (MVP): `activity` is the joined row for order.activity_id.
//
// Logo: real local asset at app/public/shafan-logo.jpg (served at /shafan-logo.jpg).
// Same-origin → html2canvas captures it cleanly; no Base44 runtime dependency.
const LOGO_SRC = "/shafan-logo.jpg";

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || "").trim());

// Shared section chrome — header band (logo right, title left) matching the
// quote-PDF look, used by both sections so they read as one document.
function SectionHeader({ title, subtitle }) {
  return (
    <div className="px-6 py-4 border-b border-blue-100" style={{ background: "rgba(59, 130, 246, 0.12)" }}>
      <div className="flex items-center justify-between gap-4">
        <img src={LOGO_SRC} alt={BRAND.name} style={{ height: "44px", objectFit: "contain" }} />
        <div className="text-left">
          <div className="text-xl font-bold text-slate-800 leading-tight">{title}</div>
          {subtitle && <div className="text-slate-500 text-xs mt-0.5">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}

export default function OrderConfirmationPDF({ order, activity, onClose }) {
  const sectionARef = useRef(null);
  const sectionBRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  if (!order) return null;

  const orderNumber = order.order_number || "—";
  const dateFormatted = order.activity_date
    ? moment(order.activity_date).format("DD/MM/YYYY")
    : "—";
  const issued = moment().format("DD/MM/YYYY");
  const activityName = activity?.name || "—";
  const participants = order.num_participants || null;
  const total = order.total_price || 0;
  const pricePerPerson =
    total && participants ? Math.round(total / participants) : null;
  const recipientEmail = order.client_email;
  const emailValid = isValidEmail(recipientEmail);

  // Render one section onto exactly ONE A4 page. If the section is taller than
  // a page it is scaled to fit (preserving aspect, centered) rather than sliced
  // across pages — this avoids the broken / near-empty trailing page. Each
  // section starts on its own page, so Section B (safety) always begins fresh.
  const addSection = async (pdf, el, isFirst) => {
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
    });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    let imgW = pageW;
    let imgH = (canvas.height * imgW) / canvas.width;
    if (imgH > pageH) {
      const s = pageH / imgH;
      imgH = pageH;
      imgW = pageW * s;
    }
    const x = (pageW - imgW) / 2;
    const imgData = canvas.toDataURL("image/png");
    if (!isFirst) pdf.addPage();
    pdf.addImage(imgData, "PNG", x, 0, imgW, imgH);
  };

  // Build the combined two-section PDF (shared by download + email).
  const buildPdf = async () => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await addSection(pdf, sectionARef.current, true);
    await addSection(pdf, sectionBRef.current, false);
    return pdf;
  };

  const fileName = `אישור_הזמנה_${orderNumber === "—" ? "מסמך" : orderNumber}.pdf`;

  const handleDownload = async () => {
    setBusy(true);
    try {
      const pdf = await buildPdf();
      pdf.save(fileName);
    } catch (err) {
      console.error("OrderConfirmationPDF download error:", err);
      toast.error("שגיאה ביצירת ה-PDF");
    } finally {
      setBusy(false);
    }
  };

  // Generate the same PDF, send it as a real attachment via the send-order-doc
  // Edge Function (Resend) to the order's client email.
  const handleEmail = async () => {
    if (!emailValid) {
      toast.error("אין כתובת אימייל תקינה ללקוח");
      return;
    }
    setEmailBusy(true);
    try {
      const pdf = await buildPdf();
      const pdfBase64 = pdf.output("datauristring").split(",")[1];
      const { data, error } = await supabase.functions.invoke("send-order-doc", {
        body: {
          to: recipientEmail,
          orderNumber: order.order_number || "",
          clientName: order.client_name || "",
          activityName,
          activityDate: dateFormatted,
          pdfBase64,
          fileName,
        },
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(JSON.stringify(data.error));
      setEmailSent(true);
      toast.success("המייל נשלח ✓");
    } catch (err) {
      console.error("OrderConfirmationPDF email error:", err);
      toast.error("שליחת המייל נכשלה");
    } finally {
      setEmailBusy(false);
    }
  };

  // WhatsApp share — Israeli phone normalization (05X… → 972…), same convention
  // as OrderDocumentDialog. No PDF attaches (browser wa.me can't); text summary.
  const waText = encodeURIComponent(
    [
      `שלום ${order.client_name || ""},`,
      "",
      `מצורף אישור ההזמנה שלך לפעילות *${activityName}* בתאריך *${dateFormatted}*.`,
      "",
      "פרטי ההזמנה:",
      `• מספר הזמנה: ${orderNumber}`,
      participants ? `• מספר משתתפים: ${participants}` : "",
      `• סה״כ לתשלום: ₪${total.toLocaleString()}`,
      "",
      "נא להחזיר את הטופס מלא וחתום.",
      "",
      "תודה! 🏔️ צוות שפן הסלע",
    ]
      .filter(Boolean)
      .join("\n")
  );
  const waPhone = (order.client_phone || "").replace(/\D/g, "").replace(/^0/, "972");
  const waLink = waPhone
    ? `https://wa.me/${waPhone}?text=${waText}`
    : `https://wa.me/?text=${waText}`;

  const sectionStyle = { fontFamily: "'Heebo', Arial, sans-serif" };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl">
        {/* Toolbar — not captured into the PDF */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex gap-2">
            <Button onClick={handleDownload} disabled={busy} className="gap-2 bg-primary">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {busy ? "מפיק PDF..." : "הורד PDF"}
            </Button>
            <Button
              onClick={handleEmail}
              disabled={emailBusy || !emailValid}
              variant="outline"
              title={emailValid ? `שלח אל ${recipientEmail}` : "אין כתובת אימייל תקינה ללקוח"}
              className="gap-2 border-blue-500 text-blue-700 hover:bg-blue-50"
            >
              {emailBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {emailBusy ? "שולח..." : emailSent ? "נשלח ✓" : "שלח במייל"}
            </Button>
            <a href={waLink} target="_blank" rel="noreferrer">
              <Button variant="outline" className="gap-2 border-green-500 text-green-700 hover:bg-green-50">
                <MessageCircle className="w-4 h-4" /> שלח וואטסאפ
              </Button>
            </a>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="space-y-4">
          {/* ===================== SECTION A — order confirmation ===================== */}
          <div
            ref={sectionARef}
            className="bg-white rounded-2xl shadow-2xl overflow-hidden"
            dir="rtl"
            style={sectionStyle}
          >
            <SectionHeader title="אישור הזמנה" subtitle={`מספר: ${orderNumber} · תאריך הפקה: ${issued}`} />

            <div className="px-6 py-4 space-y-4">
              {/* Client + event */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[11px] font-semibold text-slate-400 mb-1">פרטי לקוח</p>
                  <p className="font-bold">{order.client_name || "—"}</p>
                  {order.organization && <p className="text-slate-600 text-sm">{order.organization}</p>}
                  {order.client_phone && <p className="text-slate-500 text-sm">{order.client_phone}</p>}
                  {order.client_email && <p className="text-slate-500 text-sm">{order.client_email}</p>}
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[11px] font-semibold text-slate-400 mb-1">פרטי האירוע</p>
                  <p className="font-semibold">{dateFormatted}</p>
                  {order.start_time && <p className="text-slate-600 text-sm">🕐 {order.start_time.slice(0, 5)}</p>}
                  {order.site && <p className="text-slate-600 text-sm">📍 {order.site}</p>}
                  {participants && <p className="text-slate-600 text-sm">👥 {participants} משתתפים</p>}
                </div>
              </div>

              {/* Activity line — quote-PDF card layout: name + duration • price/person •
                  participants, full description, line total (left) with qty × unit. */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 mb-1.5">פעילות</p>
                <div className="flex gap-4 border border-slate-100 rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base">{activityName}</p>
                    <p className="text-[13px] text-slate-500 mt-0.5">
                      {activity?.duration_hours ? `⏱ ${activity.duration_hours} שעות` : ""}
                      {activity?.duration_hours && pricePerPerson ? " • " : ""}
                      {pricePerPerson ? `${pricePerPerson.toLocaleString()}₪ לאדם` : ""}
                      {participants ? ` • 👥 ${participants} משתתפים` : ""}
                    </p>
                    {activity?.description && (
                      <p className="text-[13px] text-slate-600 mt-1.5 leading-snug">{activity.description}</p>
                    )}
                  </div>
                  <div className="text-left shrink-0">
                    <p className="font-bold text-lg">{total.toLocaleString()}₪</p>
                    {participants && pricePerPerson && (
                      <p className="text-[11px] text-slate-400">{participants} × {pricePerPerson.toLocaleString()}₪</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Total + payment summary — full calculated total, VAT note. */}
              <div className="bg-slate-50 rounded-lg px-3 py-2.5 space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">סטטוס תשלום: <span className="text-slate-700">{order.payment_status || "לא שולם"}</span></span>
                  <span className="font-bold text-lg" style={{ color: "#1a4a2e" }}>סה״כ לתשלום: {total.toLocaleString()}₪</span>
                </div>
                <div className="text-left text-[11px] font-medium text-slate-500">{VAT_NOTE}</div>
              </div>

              {/* Order notes — only when present (matches the quote PDF's amber notes box). */}
              {order.notes && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                  <p className="text-[11px] font-semibold text-amber-700 mb-1">הערות</p>
                  <p className="text-[13px] text-slate-700 leading-snug">{order.notes}</p>
                </div>
              )}

              {/* Fixed order terms — clean manual RTL numbering */}
              <div className="border-t border-slate-100 pt-3">
                <p className="font-semibold mb-2">{ORDER_TERMS_INTRO}</p>
                <div className="space-y-1">
                  {ORDER_TERMS.map((t, i) => (
                    <div key={i} className="flex gap-2 text-[13px] leading-snug text-slate-700">
                      <span className="font-bold text-primary shrink-0 w-5 text-left">{i + 1}.</span>
                      <span>{t}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[13px] text-slate-600 mt-2">{ORDER_TERMS_RETURN}</p>
              </div>

              {/* Signature block */}
              <div className="border-t border-slate-100 pt-3 space-y-1.5">
                <p className="font-semibold text-sm">{SIGNATURE_BLOCK.ack}</p>
                <div className="space-y-1.5 text-sm text-slate-700">
                  {SIGNATURE_BLOCK.fields.map((f, i) => (
                    <p key={i}>{f}</p>
                  ))}
                </div>
                <div className="pt-1 text-sm text-slate-700">
                  {SIGNATURE_BLOCK.closing.map((c, i) => (
                    <p key={i}>{c}</p>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-blue-100 pt-2 text-center text-[11px] text-slate-400 space-y-0.5">
                <p>{BRAND.name} — {BRAND.tagline}</p>
                <p className="font-medium text-slate-500">{MOBILE_CONTACT}</p>
              </div>
            </div>
          </div>

          {/* ===================== SECTION B — safety / health declaration ===================== */}
          <div
            ref={sectionBRef}
            className="bg-white rounded-2xl shadow-2xl overflow-hidden"
            dir="rtl"
            style={sectionStyle}
          >
            <SectionHeader title={SAFETY_TITLE} />

            <div className="px-6 py-4 space-y-3">
              <p className="text-sm text-slate-700">{SAFETY_GROUP_FIELD}</p>

              <div className="space-y-1">
                {SAFETY_RULES.map((r, i) => (
                  <div key={i} className="flex gap-2 text-[13px] leading-snug text-slate-700">
                    <span className="font-bold text-primary shrink-0 w-5 text-left">{i + 1}.</span>
                    <span>{r}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-2 text-[12.5px] text-slate-700 leading-snug border-t border-slate-100 pt-3">
                {SAFETY_DECLARATION.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>

              <p className="text-sm text-slate-700 border-t border-slate-100 pt-3">{SAFETY_SIGNATURE}</p>

              <div className="border-t border-slate-100 pt-3">
                <p className="font-bold text-sm">{SAFETY_MINORS_HEADER}</p>
                <p className="text-sm text-slate-700 mt-1.5">{SAFETY_MINORS_TEXT}</p>
                <p className="text-sm text-slate-700 mt-2">{SAFETY_SIGNATURE}</p>
              </div>

              <div className="border-t border-blue-100 pt-2 text-center text-[10px] text-slate-400">
                <p>{SAFETY_CONTACT}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
