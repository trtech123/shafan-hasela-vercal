import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { normalizeClubPayload } from "@/lib/clubDomain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const weekdays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const emptyRule = () => ({
  weekday: 1,
  start_time: "16:00",
  end_time: "17:00",
  effective_from: "",
  effective_until: "",
});

const emptyForm = () => ({
  name: "",
  description: "",
  instructor_id: "",
  site: "",
  capacity: "",
  monthly_price: "",
  default_billing_day: "1",
  status: "active",
  notes: "",
  schedule_rules: [emptyRule()],
});

export default function ClubFormDialog({
  open,
  onClose,
  club,
  scheduleRules,
  instructors,
  onSaved,
}) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!club) {
      setForm(emptyForm());
      return;
    }
    setForm({
      name: club.name || "",
      description: club.description || "",
      instructor_id: club.instructor_id || "",
      site: club.site || "",
      capacity: club.capacity ?? "",
      monthly_price: club.monthly_price ?? "",
      default_billing_day: club.default_billing_day ?? 1,
      status: club.status || "active",
      notes: club.notes || "",
      schedule_rules: scheduleRules?.length
        ? scheduleRules.map((rule) => ({
          weekday: rule.weekday,
          start_time: String(rule.start_time).slice(0, 5),
          end_time: String(rule.end_time).slice(0, 5),
          effective_from: rule.effective_from || "",
          effective_until: rule.effective_until || "",
        }))
        : [emptyRule()],
    });
  }, [club, open, scheduleRules]);

  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const changeRule = (index, field, value) => setForm((current) => ({
    ...current,
    schedule_rules: current.schedule_rules.map((rule, ruleIndex) =>
      ruleIndex === index ? { ...rule, [field]: value } : rule),
  }));

  const addRule = () => change("schedule_rules", [...form.schedule_rules, emptyRule()]);
  const removeRule = (index) => {
    if (form.schedule_rules.length === 1) return;
    change("schedule_rules", form.schedule_rules.filter((_, ruleIndex) => ruleIndex !== index));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const normalized = normalizeClubPayload(form);
      let clubId = club?.id;
      if (clubId) {
        const { error } = await supabase.from("clubs").update(normalized.club).eq("id", clubId);
        if (error) throw error;
        const { error: deleteError } = await supabase
          .from("club_schedule_rules")
          .delete()
          .eq("club_id", clubId);
        if (deleteError) throw deleteError;
      } else {
        const { data, error } = await supabase
          .from("clubs")
          .insert(normalized.club)
          .select("id")
          .single();
        if (error || !data) throw error || new Error("club insert returned no id");
        clubId = data.id;
      }

      const { error: rulesError } = await supabase
        .from("club_schedule_rules")
        .insert(normalized.rules.map((rule) => ({ ...rule, club_id: clubId })));
      if (rulesError) throw rulesError;

      toast.success(club ? "החוג עודכן" : "החוג נוצר");
      await onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שגיאה בשמירת החוג");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{club ? "עריכת חוג" : "חוג חדש"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="club-name">שם החוג</Label>
              <Input id="club-name" value={form.name} onChange={(e) => change("name", e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="club-instructor">מדריך</Label>
              <select id="club-instructor" className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.instructor_id} onChange={(e) => change("instructor_id", e.target.value)}>
                <option value="">ללא מדריך</option>
                {instructors.map((instructor) => (
                  <option key={instructor.id} value={instructor.id}>{instructor.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="club-site">אתר / מיקום</Label>
              <Input id="club-site" value={form.site} onChange={(e) => change("site", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="club-capacity">קיבולת</Label>
              <Input id="club-capacity" type="number" min="1" value={form.capacity} onChange={(e) => change("capacity", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="club-price">מחיר חודשי</Label>
              <Input id="club-price" type="number" min="0" step="0.01" value={form.monthly_price} onChange={(e) => change("monthly_price", e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="club-billing-day">יום חיוב</Label>
              <Input id="club-billing-day" type="number" min="1" max="28" value={form.default_billing_day} onChange={(e) => change("default_billing_day", e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="club-status">סטטוס</Label>
              <select id="club-status" className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.status} onChange={(e) => change("status", e.target.value)}>
                <option value="active">פעיל</option>
                <option value="inactive">לא פעיל</option>
                <option value="archived">בארכיון</option>
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="club-description">תיאור</Label>
            <Textarea id="club-description" value={form.description} onChange={(e) => change("description", e.target.value)} rows={2} />
          </div>

          <section className="rounded-2xl border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">מערכת שבועית</h3>
                <p className="text-xs text-muted-foreground">כללים חוזרים בלבד — לא נוצרות הזמנות לכל מפגש.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addRule} aria-label="הוספת מפגש שבועי">
                <Plus className="ml-1 h-4 w-4" /> הוספת מפגש
              </Button>
            </div>
            {form.schedule_rules.map((rule, index) => (
              <div key={index} className="grid gap-3 rounded-xl border bg-background p-3 md:grid-cols-[1.1fr_1fr_1fr_auto]">
                <div>
                  <Label htmlFor={`rule-weekday-${index}`}>יום בשבוע {index + 1}</Label>
                  <select id={`rule-weekday-${index}`} aria-label={`יום בשבוע ${index + 1}`} className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={rule.weekday} onChange={(e) => changeRule(index, "weekday", e.target.value)}>
                    {weekdays.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`rule-start-${index}`}>שעת התחלה {index + 1}</Label>
                  <Input id={`rule-start-${index}`} aria-label={`שעת התחלה ${index + 1}`} type="time" value={rule.start_time} onChange={(e) => changeRule(index, "start_time", e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor={`rule-end-${index}`}>שעת סיום {index + 1}</Label>
                  <Input id={`rule-end-${index}`} aria-label={`שעת סיום ${index + 1}`} type="time" value={rule.end_time} onChange={(e) => changeRule(index, "end_time", e.target.value)} required />
                </div>
                <Button type="button" variant="ghost" size="icon" className="self-end text-red-500" disabled={form.schedule_rules.length === 1} onClick={() => removeRule(index)} aria-label={`מחיקת מפגש ${index + 1}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </section>

          <div>
            <Label htmlFor="club-notes">הערות</Label>
            <Textarea id="club-notes" value={form.notes} onChange={(e) => change("notes", e.target.value)} rows={2} />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={saving}>{saving ? "שומר..." : "שמירת חוג"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
