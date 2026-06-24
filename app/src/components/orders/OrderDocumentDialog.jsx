import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Share2, FileText, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import moment from "moment";
import { supabase } from "@/api/supabaseClient";

export default function OrderDocumentDialog({ open, onClose, order, activity }) {
  const [waSending, setWaSending] = useState(false);

  if (!order) return null;

  const activityName = activity?.name || "—";
  const dateFormatted = order.activity_date ? moment(order.activity_date).format("DD/MM/YYYY") : "—";
  const pricePerPerson = order.total_price && order.num_participants
    ? Math.round(order.total_price / order.num_participants)
    : null;

  const docText = `
אדוונצ׳ר פארק — אישור הזמנה
=============================

מספר הזמנה: ${order.order_number || "—"}
תאריך הפקה: ${moment().format("DD/MM/YYYY")}

פרטי הלקוח
-----------
שם: ${order.client_name}${order.organization ? `\nארגון / חברה: ${order.organization}` : ""}${order.client_phone ? `\nטלפון: ${order.client_phone}` : ""}${order.client_email ? `\nאימייל: ${order.client_email}` : ""}

פרטי הפעילות
-------------
פעילות: ${activityName}
תאריך: ${dateFormatted}${order.start_time ? `\nשעת התחלה: ${order.start_time}` : ""}
מספר משתתפים: ${order.num_participants || "—"}

תמחור
------
${pricePerPerson ? `מחיר לאדם: ₪${pricePerPerson.toLocaleString()}` : ""}
סה״כ לתשלום: ₪${(order.total_price || 0).toLocaleString()}
סטטוס תשלום: ${order.payment_status || "לא שולם"}

תנאים כלליים
-------------
• ביטול עד 7 ימים לפני הפעילות — ללא עלות.
• ביטול 3–7 ימים לפני — 50% דמי ביטול.
• ביטול פחות מ-3 ימים — 100% דמי ביטול.
• החברה שומרת לעצמה הזכות לשנות או לבטל פעילות בתנאי מזג אוויר קיצוניים.

אישור הלקוח
------------
אני הח״מ מאשר/ת את פרטי ההזמנה לעיל ומסכים/ה לתנאים הכלליים.

שם מלא: _______________________

חתימה: _______________________

תאריך: _______________________
`.trim();

  const whatsappMessage = `שלום ${order.client_name},\n\nמצורף אישור ההזמנה שלך לפעילות *${activityName}* בתאריך *${dateFormatted}*.\n\nפרטי ההזמנה:\n• מספר משתתפים: ${order.num_participants}\n• סה״כ לתשלום: ₪${(order.total_price || 0).toLocaleString()}\n\nאנא השב/י לאישור.\n\nתודה! 🏔️`;
  const whatsappText = encodeURIComponent(whatsappMessage);

  // Send via Meta WhatsApp Cloud API (server-side token, no exposure in client).
  // Requires Edge Function send-whatsapp deployed with META_WHATSAPP_TOKEN +
  // META_PHONE_NUMBER_ID secrets. Phase 1 = test number only.
  const handleWhatsAppAPI = async () => {
    if (!order.client_phone) {
      toast.error("אין מספר טלפון ללקוח");
      return;
    }
    setWaSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp", {
        body: { phone: order.client_phone, message: whatsappMessage },
      });
      if (error || !data?.ok) {
        toast.error(`שליחת WhatsApp נכשלה: ${data?.error ?? error?.message ?? "שגיאה לא ידועה"}`);
      } else {
        toast.success("הודעת WhatsApp נשלחה בהצלחה");
      }
    } catch (e) {
      toast.error(`שגיאה: ${e?.message ?? String(e)}`);
    } finally {
      setWaSending(false);
    }
  };

  const whatsappLink = order.client_phone
    ? `https://wa.me/972${order.client_phone.replace(/^0/, "").replace(/-/g, "")}?text=${whatsappText}`
    : `https://wa.me/?text=${whatsappText}`;

  const emailSubject = encodeURIComponent(`אישור הזמנה — ${activityName} | ${dateFormatted}`);
  const emailBody = encodeURIComponent(docText);
  const mailtoLink = `mailto:${order.client_email || ""}?subject=${emailSubject}&body=${emailBody}`;

  const copyDoc = () => {
    navigator.clipboard.writeText(docText);
    toast.success("המסמך הועתק ללוח");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            מסמך הזמנה ללקוח
          </DialogTitle>
        </DialogHeader>

        {/* Document preview */}
        <div className="flex-1 overflow-y-auto">
          <pre className="text-sm bg-muted/40 border border-border rounded-xl p-5 whitespace-pre-wrap font-sans leading-relaxed text-foreground">
            {docText}
          </pre>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-4 border-t border-border justify-between">
          <Button variant="outline" className="gap-2" onClick={copyDoc}>
            <Copy className="w-4 h-4" /> העתק מסמך
          </Button>

          <div className="flex gap-2 flex-wrap">
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-2 text-green-600 border-green-200 hover:bg-green-50">
                <Share2 className="w-4 h-4" /> שלח בוואטסאפ
              </Button>
            </a>
            <Button
              variant="outline"
              className="gap-2 text-green-700 border-green-300 hover:bg-green-50"
              onClick={handleWhatsAppAPI}
              disabled={waSending || !order.client_phone}
              title={!order.client_phone ? "אין מספר טלפון ללקוח" : "שלח דרך Meta WhatsApp Cloud API"}
            >
              {waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
              WA API
            </Button>
            <a href={mailtoLink} target="_blank" rel="noopener noreferrer">
              <Button className="gap-2">
                <Share2 className="w-4 h-4" /> שלח במייל
              </Button>
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}