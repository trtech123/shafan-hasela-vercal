import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";

const ALL_SPECIALTIES = ["הפעלת פארק", "יום גיבוש", "חוג טיפוס", "סדנת שטח"];

const emptyForm = {
  full_name: "", phone: "", email: "", specialties: [], notes: "", status: "פעיל",
};

export default function InstructorFormDialog({ open, onClose, instructor, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (instructor) {
      setForm({
        full_name: instructor.full_name || "",
        phone: instructor.phone || "",
        email: instructor.email || "",
        specialties: instructor.specialties || [],
        notes: instructor.notes || "",
        status: instructor.status || "פעיל",
      });
    } else {
      setForm(emptyForm);
    }
  }, [instructor, open]);

  const toggleSpecialty = (spec) => {
    setForm(prev => ({
      ...prev,
      specialties: prev.specialties.includes(spec)
        ? prev.specialties.filter(s => s !== spec)
        : [...prev.specialties, spec],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      let error;
      if (instructor) {
        ({ error } = await supabase.from('instructors').update(form).eq('id', instructor.id));
      } else {
        ({ error } = await supabase.from('instructors').insert(form));
      }
      if (error) {
        console.error('save instructor error:', error);
        toast.error('שגיאה בשמירת המדריך');
        return;
      }
      toast.success(instructor ? 'המדריך עודכן' : 'המדריך נוצר');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>{instructor ? "עריכת מדריך" : "מדריך חדש"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label>שם מלא *</Label>
            <Input value={form.full_name} onChange={e => setForm(p => ({...p, full_name: e.target.value}))} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>טלפון *</Label>
              <Input value={form.phone} onChange={e => setForm(p => ({...p, phone: e.target.value}))} required />
            </div>
            <div>
              <Label>אימייל</Label>
              <Input type="email" value={form.email} onChange={e => setForm(p => ({...p, email: e.target.value}))} />
            </div>
          </div>
          <div>
            <Label className="mb-2 block">התמחויות</Label>
            <div className="space-y-2">
              {ALL_SPECIALTIES.map(spec => (
                <div key={spec} className="flex items-center gap-2">
                  <Checkbox
                    id={spec}
                    checked={form.specialties.includes(spec)}
                    onCheckedChange={() => toggleSpecialty(spec)}
                  />
                  <label htmlFor={spec} className="text-sm cursor-pointer">{spec}</label>
                </div>
              ))}
            </div>
          </div>
          <div>
            <Label>הערות</Label>
            <Textarea value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))} rows={2} />
          </div>
          <div>
            <Label>סטטוס</Label>
            <Select value={form.status} onValueChange={v => setForm(p => ({...p, status: v}))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="פעיל">פעיל</SelectItem>
                <SelectItem value="לא פעיל">לא פעיל</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={saving}>{saving ? "שומר..." : instructor ? "עדכון" : "הוסף מדריך"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}