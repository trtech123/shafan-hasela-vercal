import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import moment from "moment";

// Sites match the orders/quotes/maintenance enum. blocked_slots.site is
// free TEXT (no CHECK), so the UI is the source of truth for valid values.
const SITES = ["עכו", "טבריה", "נוף הגליל", "שטח", "פודטראק", "קפה אקסטרים"];

// Radix Select forbids empty-string `value`; use a sentinel for "all sites"
// and coerce back to NULL on save (blocked_slots.site nullable).
const ALL_SITES = "__all__";

// Same 30-min granularity as OrderFormDialog so a block hour-range can
// match an order's start/end exactly.
const TIME_SLOTS = [
  "07:00","07:30","08:00","08:30","09:00","09:30","10:00","10:30",
  "11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30",
  "15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30",
  "19:00","19:30","20:00",
];

const REASON_SUGGESTIONS = ["חג", "תחזוקה", "מנוחה", "אירוע פרטי", "אחר"];

const emptyForm = {
  block_date: "",
  site: ALL_SITES,
  mode: "all_day",        // 'all_day' | 'hours'
  start_time: "",
  end_time: "",
  reason: "",
};

export default function BlockSlotDialog({ open, onClose, block, defaultDate, defaultReason, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const isEdit = !!block;
  const isOrderLock = block?.source === "order_lock";

  useEffect(() => {
    if (!open) return;
    if (block) {
      setForm({
        block_date: block.block_date || "",
        site: block.site ?? ALL_SITES,
        mode: block.start_time && block.end_time ? "hours" : "all_day",
        // Postgres TIME returns 'HH:MM:SS'; the picker uses 'HH:MM'.
        start_time: block.start_time ? block.start_time.slice(0, 5) : "",
        end_time: block.end_time ? block.end_time.slice(0, 5) : "",
        reason: block.reason || "",
      });
    } else {
      // Create mode: prefill date and (optionally) reason. site + mode use
      // emptyForm defaults (ALL_SITES + all_day) — matches the holiday
      // "block this day" flow.
      setForm({ ...emptyForm, block_date: defaultDate || "", reason: defaultReason || "" });
    }
  }, [open, block, defaultDate, defaultReason]);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSuggestedReason = (text) => {
    // "אחר" is the free-text option — clear the field so the user types.
    if (text === "אחר") {
      handleChange("reason", "");
      return;
    }
    // Toggle: clicking the active chip clears it.
    handleChange("reason", form.reason === text ? "" : text);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.block_date) { toast.error("יש לבחור תאריך"); return; }
    if (form.mode === "hours") {
      if (!form.start_time || !form.end_time) { toast.error("יש לבחור שעת התחלה ושעת סיום"); return; }
      if (form.start_time >= form.end_time) { toast.error("שעת התחלה חייבת להיות לפני שעת סיום"); return; }
    }
    if (!form.reason.trim()) { toast.error("יש להזין סיבה"); return; }

    setSaving(true);
    try {
      // Explicit payload (no spread): blocked_slots.site is nullable TEXT,
      // start/end_time are nullable TIME columns. Postgres rejects empty
      // string for TIME, and the CHECK constraint enforces (both NULL) OR
      // (both set with start < end).
      const payload = {
        block_date: form.block_date,
        site: form.site === ALL_SITES ? null : form.site,
        start_time: form.mode === "hours" ? form.start_time : null,
        end_time:   form.mode === "hours" ? form.end_time   : null,
        reason: form.reason.trim(),
      };

      let error;
      if (isEdit) {
        // Source preserved by Postgres on UPDATE (no field in payload).
        ({ error } = await supabase.from('blocked_slots').update(payload).eq('id', block.id));
      } else {
        // `source` defaults to 'manual' in the schema; no need to send it.
        ({ error } = await supabase.from('blocked_slots').insert(payload));
      }

      if (error) {
        console.error('save block error:', error);
        toast.error('שגיאה בשמירת החסימה');
        return;
      }

      toast.success(isEdit ? 'החסימה עודכנה' : 'החסימה נוצרה');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('save block error:', err);
      toast.error('שגיאה בשמירת החסימה');
    } finally {
      setSaving(false);
    }
  };

  const isPast = form.block_date && form.block_date < moment().format("YYYY-MM-DD");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "עריכת חסימה" : "חסימת זמן"}</DialogTitle>
        </DialogHeader>

        {isOrderLock && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
            חסימה אוטומטית שנוצרה מהזמנה. עריכת התאריך / האתר / השעות עלולה לגרום לפער מההזמנה המקורית. תימחק אוטומטית אם ההזמנה תימחק.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label>תאריך *</Label>
            <Input
              type="date"
              value={form.block_date}
              onChange={e => handleChange("block_date", e.target.value)}
              required
            />
            {isPast && <p className="text-xs text-amber-600 mt-1">החסימה בעבר</p>}
          </div>

          <div>
            <Label>אתר</Label>
            <Select value={form.site} onValueChange={v => handleChange("site", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SITES}>כל האתרים</SelectItem>
                {SITES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>סוג חסימה</Label>
            <div className="flex gap-2 mt-1">
              {[
                { key: "all_day", label: "כל היום" },
                { key: "hours",   label: "שעות מסוימות" },
              ].map(m => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => handleChange("mode", m.key)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
                    form.mode === m.key
                      ? "bg-primary/10 text-primary border-primary/30 shadow-sm"
                      : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
                  )}
                >{m.label}</button>
              ))}
            </div>
          </div>

          {form.mode === "hours" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>שעת התחלה *</Label>
                <Select value={form.start_time} onValueChange={v => handleChange("start_time", v)}>
                  <SelectTrigger><SelectValue placeholder="בחרי שעה" /></SelectTrigger>
                  <SelectContent>
                    {TIME_SLOTS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>שעת סיום *</Label>
                <Select value={form.end_time} onValueChange={v => handleChange("end_time", v)}>
                  <SelectTrigger><SelectValue placeholder="בחרי שעה" /></SelectTrigger>
                  <SelectContent>
                    {TIME_SLOTS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div>
            <Label>סיבה *</Label>
            <Input
              value={form.reason}
              onChange={e => handleChange("reason", e.target.value)}
              placeholder="לדוגמה: חג סוכות, תחזוקת ציוד..."
              required
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {REASON_SUGGESTIONS.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleSuggestedReason(r)}
                  className={cn(
                    "px-2.5 py-0.5 rounded-full text-xs font-medium border transition-all",
                    form.reason === r
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-background text-muted-foreground border-border hover:bg-muted"
                  )}
                >{r}</button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "שומר..." : (isEdit ? "עדכון" : "שמירה")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
