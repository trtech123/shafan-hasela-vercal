import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Mail, Phone, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import moment from "moment";

// Daily grouped invitation: one message summarizing ALL of an instructor's
// activities for a given day. Mirrors InstructorEmailDialog's per-activity
// logic (mailto + wa.me, Israeli phone normalization) but loops over the day's
// orders. Does not replace the per-activity dialog.
export default function InstructorDailyDialog({ open, onClose, instructor, date, dayOrders, activities, onNotifiedAll }) {
  if (!instructor) return null;

  const dateFmt = date ? moment(date).format("DD/MM/YYYY") : "—";
  const activityName = (id) => activities.find((a) => a.id === id)?.name || "—";

  // Sort by start time so the summary reads in chronological order.
  const orders = [...(dayOrders || [])].sort((a, b) =>
    (a.start_time || "").localeCompare(b.start_time || ""),
  );

  const lineFor = (o) => {
    const parts = [
      `• ${activityName(o.activity_id)}`,
      o.start_time ? `🕐 ${o.start_time}${o.end_time ? `–${o.end_time}` : ""}` : "",
      o.site ? `📍 ${o.site}` : "",
      o.client_name ? `👤 ${o.client_name}${o.organization ? ` (${o.organization})` : ""}` : "",
      o.num_participants ? `👥 ${o.num_participants}` : "",
    ].filter(Boolean);
    let line = parts.join(" · ");
    if (o.notes) line += `\n   הערות: ${o.notes}`;
    return line;
  };

  const body = [
    `שלום ${instructor.full_name},`,
    ``,
    `להלן סיכום הפעילויות שלך לתאריך ${dateFmt}:`,
    ``,
    ...orders.map(lineFor),
    ``,
    `סה״כ ${orders.length} פעילויות. בהצלחה!`,
  ].join("\n");

  // Israeli phone normalization: 05X-XXXXXXX → 9725XXXXXXXX (wa.me wants digits).
  const phoneDigits = (instructor.phone || "").replace(/\D/g, "");
  const waPhone = phoneDigits.startsWith("0") ? `972${phoneDigits.slice(1)}` : phoneDigits;
  const waLink = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(body)}` : null;

  const subject = `סיכום פעילויות יומי — ${dateFmt}`;
  const mailtoLink = instructor.email
    ? `mailto:${instructor.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} הועתק ללוח`);
  };

  const handleSent = () => { if (onNotifiedAll) onNotifiedAll(); };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>סיכום יומי למדריך</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="bg-muted/50 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{instructor.full_name}</p>
              <span className="text-xs text-muted-foreground">{dateFmt} · {orders.length} פעילויות</span>
            </div>
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

          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">אין פעילויות למדריך זה בתאריך זה.</p>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">תוכן ההודעה המוכן:</p>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => copyToClipboard(body, "תוכן ההודעה")}>
                  <Copy className="w-3 h-3" /> העתק הכל
                </Button>
              </div>
              <pre className="text-xs bg-muted/50 border border-border rounded-xl p-3 whitespace-pre-wrap font-sans leading-relaxed max-h-56 overflow-y-auto">
                {body}
              </pre>
            </div>
          )}

          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>סגור</Button>
            {orders.length > 0 && waLink && (
              <a href={waLink} target="_blank" rel="noopener noreferrer" onClick={handleSent}>
                <Button className="gap-2 bg-green-600 hover:bg-green-700 text-white">
                  <MessageCircle className="w-4 h-4" /> שלח בוואטסאפ
                </Button>
              </a>
            )}
            {orders.length > 0 && mailtoLink && (
              <a href={mailtoLink} target="_blank" rel="noopener noreferrer" onClick={handleSent}>
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
