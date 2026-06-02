import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Mail, Phone, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import moment from "moment";

export default function InstructorEmailDialog({ open, onClose, order, instructor, activity, onNotified }) {
  if (!instructor) return null;

  const dateFmt = order?.activity_date ? moment(order.activity_date).format("DD/MM/YYYY") : "—";

  const subject = `שיבוץ לפעילות — ${activity?.name || ""} בתאריך ${order?.activity_date || ""}`;
  const body = `שלום ${instructor.full_name},

שובצת לפעילות הבאה:

פעילות: ${activity?.name || "—"}
תאריך: ${dateFmt}
שעת התחלה: ${order?.start_time || "לא צוין"}
לקוח: ${order?.client_name || ""}${order?.organization ? ` (${order.organization})` : ""}
מספר משתתפים: ${order?.num_participants || ""}
${order?.notes ? `הערות: ${order.notes}` : ""}

בהצלחה!`;

  const waBody = [
    `שלום ${instructor.full_name},`,
    ``,
    `שיבוץ לפעילות:`,
    `🏔️ ${activity?.name || "—"}`,
    `📅 ${dateFmt}`,
    order?.start_time ? `🕐 ${order.start_time}${order?.end_time ? `–${order.end_time}` : ""}` : "",
    order?.site ? `📍 ${order.site}` : "",
    order?.client_name ? `👤 לקוח: ${order.client_name}${order?.organization ? ` (${order.organization})` : ""}` : "",
    order?.num_participants ? `👥 ${order.num_participants} משתתפים` : "",
    order?.notes ? `\nהערות: ${order.notes}` : "",
    ``,
    `בהצלחה!`,
  ].filter(Boolean).join("\n");

  // Israeli phone normalization: 05X-XXXXXXX → 9725XXXXXXXX.
  // Matches OrderDocumentDialog convention; wa.me requires digits only.
  const phoneDigits = (instructor.phone || "").replace(/\D/g, "");
  const waPhone = phoneDigits.startsWith("0") ? `972${phoneDigits.slice(1)}` : phoneDigits;
  const waLink = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waBody)}`
    : null;

  const handleWhatsAppClick = () => {
    if (onNotified) onNotified();
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} הועתק ללוח`);
  };

  const mailtoLink = `mailto:${instructor.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>שליחת אישור למדריך</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Instructor info */}
          <div className="bg-muted/50 rounded-xl p-4 space-y-2">
            <p className="font-semibold">{instructor.full_name}</p>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="w-4 h-4" />
                <span dir="ltr">{instructor.phone}</span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => copyToClipboard(instructor.phone, "טלפון")}>
                <Copy className="w-3 h-3" /> העתק
              </Button>
            </div>
            {instructor.email && (
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="w-4 h-4" />
                  <span>{instructor.email}</span>
                </div>
                <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => copyToClipboard(instructor.email, "אימייל")}>
                  <Copy className="w-3 h-3" /> העתק
                </Button>
              </div>
            )}
          </div>

          {/* Email content preview */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium">תוכן המייל המוכן:</p>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => copyToClipboard(body, "תוכן המייל")}>
                <Copy className="w-3 h-3" /> העתק הכל
              </Button>
            </div>
            <pre className="text-xs bg-muted/50 border border-border rounded-xl p-3 whitespace-pre-wrap font-sans leading-relaxed max-h-48 overflow-y-auto">
              {body}
            </pre>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>סגור</Button>
            {waLink && (
              <a href={waLink} target="_blank" rel="noopener noreferrer" onClick={handleWhatsAppClick}>
                <Button className="gap-2 bg-green-600 hover:bg-green-700 text-white">
                  <MessageCircle className="w-4 h-4" /> שלח בוואטסאפ
                </Button>
              </a>
            )}
            {instructor.email && (
              <a href={mailtoLink} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="gap-2">
                  <Mail className="w-4 h-4" /> פתח ב-Gmail / Outlook
                </Button>
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}