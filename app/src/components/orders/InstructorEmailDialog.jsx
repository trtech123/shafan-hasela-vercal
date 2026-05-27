import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Mail, Phone, Info } from "lucide-react";
import { toast } from "sonner";
import moment from "moment";

export default function InstructorEmailDialog({ open, onClose, order, instructor, activity }) {
  if (!instructor) return null;

  const subject = `שיבוץ לפעילות — ${activity?.name || ""} בתאריך ${order?.activity_date || ""}`;
  const body = `שלום ${instructor.full_name},

שובצת לפעילות הבאה:

פעילות: ${activity?.name || "—"}
תאריך: ${order?.activity_date ? moment(order.activity_date).format("DD/MM/YYYY") : "—"}
שעת התחלה: ${order?.start_time || "לא צוין"}
לקוח: ${order?.client_name || ""}${order?.organization ? ` (${order.organization})` : ""}
מספר משתתפים: ${order?.num_participants || ""}
${order?.notes ? `הערות: ${order.notes}` : ""}

בהצלחה!`;

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
          {/* Upgrade notice */}
          <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>שליחה אוטומטית תהיה זמינה לאחר שדרוג ל-Builder+. בינתיים ניתן לשלוח ידנית:</span>
          </div>

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
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>סגור</Button>
            {instructor.email && (
              <a href={mailtoLink} target="_blank" rel="noopener noreferrer">
                <Button className="gap-2">
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