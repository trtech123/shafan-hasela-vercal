import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Radix <Select> reserves "" for the unselected state, and the assigned_to UUID FK
// rejects both "" and a non-UUID value — so we represent "no assignee" with this
// sentinel and coerce it back to null on save.
const NO_ASSIGNEE = "__none__";

const EMPTY = {
  title: "",
  description: "",
  due_date: "",
  due_time: "",
  assigned_to: NO_ASSIGNEE,
  priority: "בינונית",
  status: "פתוחה",
  category: "אחר",
};

export default function TaskFormDialog({ open, onClose, task, onSaved, profiles = [] }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(task ? {
      title: task.title || "",
      description: task.description || "",
      due_date: task.due_date || "",
      due_time: task.due_time ? task.due_time.slice(0, 5) : "", // Postgres TIME → "HH:MM:SS"; <input type=time> wants "HH:MM"
      assigned_to: task.assigned_to ?? NO_ASSIGNEE,
      priority: task.priority || "בינונית",
      status: task.status || "פתוחה",
      category: task.category || "אחר",
    } : EMPTY);
  }, [open, task]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Explicit payload — never spread `form` into a typed table: Postgres rejects ""
      // for DATE/TIME/UUID columns. Coerce empties + the assignee sentinel to null.
      const payload = {
        title: form.title,
        description: form.description || null,
        due_date: form.due_date || null,   // DATE NOT NULL — input is required; this is defense-in-depth
        due_time: form.due_time || null,   // TIME — "" is invalid syntax
        priority: form.priority,
        status: form.status,
        category: form.category || null,
        assigned_to: (form.assigned_to && form.assigned_to !== NO_ASSIGNEE) ? form.assigned_to : null,
      };
      let error;
      if (task?.id) {
        ({ error } = await supabase.from('tasks').update(payload).eq('id', task.id));
      } else {
        ({ error } = await supabase.from('tasks').insert(payload));
      }
      if (error) {
        console.error('save task error:', error);
        toast.error('שגיאה בשמירת המשימה');
        return;
      }
      toast.success(task ? 'המשימה עודכנה' : 'המשימה נוצרה');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>{task ? "עריכת משימה" : "משימה חדשה"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>כותרת *</Label>
            <Input value={form.title} onChange={e => set("title", e.target.value)} required />
          </div>
          <div>
            <Label>תיאור</Label>
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>תאריך יעד *</Label>
              <Input type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} required />
            </div>
            <div>
              <Label>שעה</Label>
              <Input type="time" value={form.due_time} onChange={e => set("due_time", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>עדיפות</Label>
              <Select value={form.priority} onValueChange={v => set("priority", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["נמוכה","בינונית","גבוהה","דחופה"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>קטגוריה</Label>
              <Select value={form.category} onValueChange={v => set("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["ציוד","תחזוקה","אדמיניסטרציה","הכשרה","שיווק","אחר"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>סטטוס</Label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["פתוחה","בביצוע","הושלמה","בוטלה"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>אחראי</Label>
              <Select value={form.assigned_to} onValueChange={v => set("assigned_to", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ASSIGNEE}>ללא אחראי</SelectItem>
                  {profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email || p.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={saving}>{saving ? "שומר..." : "שמור"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}