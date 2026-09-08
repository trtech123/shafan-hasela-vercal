import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { buildMembershipRegistration } from "@/lib/clubDomain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const today = () => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const emptyForm = (club) => ({
  first_name: "",
  last_name: "",
  birth_date: "",
  phone: "",
  email: "",
  primary_contact_name: "",
  primary_contact_relationship: "",
  primary_contact_phone: "",
  primary_contact_email: "",
  starts_on: today(),
  monthly_price: club?.monthly_price ?? "",
  billing_day: club?.default_billing_day ?? 1,
  notes: "",
  membership_notes: "",
});

export default function MemberRegistrationDialog({ open, onClose, club, onSaved }) {
  const [form, setForm] = useState(() => emptyForm(club));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(emptyForm(club));
  }, [club, open]);

  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!club) return;
    setSaving(true);
    let participantId = null;
    try {
      const registration = buildMembershipRegistration(form, club);
      const { data: participant, error: participantError } = await supabase
        .from("club_participants")
        .insert(registration.participant)
        .select("id")
        .single();
      if (participantError || !participant) throw participantError || new Error("participant insert returned no id");
      participantId = participant.id;

      const { error: membershipError } = await supabase
        .from("club_memberships")
        .insert({ ...registration.membership, participant_id: participantId });
      if (membershipError) throw membershipError;

      toast.success("המשתתף נרשם לחוג");
      await onSaved?.();
      onClose();
    } catch (error) {
      if (participantId) {
        await supabase.from("club_participants").delete().eq("id", participantId);
      }
      toast.error(error instanceof Error ? error.message : "שגיאה ברישום המשתתף");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>רישום ל{club?.name || "חוג"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <section className="space-y-3">
            <h3 className="font-semibold">פרטי משתתף</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label htmlFor="member-first-name">שם פרטי</Label><Input id="member-first-name" value={form.first_name} onChange={(e) => change("first_name", e.target.value)} required /></div>
              <div><Label htmlFor="member-last-name">שם משפחה</Label><Input id="member-last-name" value={form.last_name} onChange={(e) => change("last_name", e.target.value)} required /></div>
              <div><Label htmlFor="member-birth-date">תאריך לידה</Label><Input id="member-birth-date" type="date" value={form.birth_date} onChange={(e) => change("birth_date", e.target.value)} /></div>
              <div><Label htmlFor="member-phone">טלפון משתתף</Label><Input id="member-phone" value={form.phone} onChange={(e) => change("phone", e.target.value)} /></div>
              <div className="md:col-span-2"><Label htmlFor="member-email">אימייל משתתף</Label><Input id="member-email" type="email" value={form.email} onChange={(e) => change("email", e.target.value)} /></div>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border bg-muted/20 p-4">
            <div>
              <h3 className="font-semibold">איש קשר עיקרי</h3>
              <p className="text-xs text-muted-foreground">יכול להיות הורה, אפוטרופוס או המשתתף עצמו.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label htmlFor="contact-name">שם איש קשר</Label><Input id="contact-name" value={form.primary_contact_name} onChange={(e) => change("primary_contact_name", e.target.value)} /></div>
              <div><Label htmlFor="contact-relation">קרבה</Label><Input id="contact-relation" value={form.primary_contact_relationship} onChange={(e) => change("primary_contact_relationship", e.target.value)} /></div>
              <div><Label htmlFor="contact-phone">טלפון איש קשר</Label><Input id="contact-phone" value={form.primary_contact_phone} onChange={(e) => change("primary_contact_phone", e.target.value)} /></div>
              <div><Label htmlFor="contact-email">אימייל איש קשר</Label><Input id="contact-email" type="email" value={form.primary_contact_email} onChange={(e) => change("primary_contact_email", e.target.value)} /></div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="font-semibold">פרטי חברות</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <div><Label htmlFor="membership-start">תאריך התחלה</Label><Input id="membership-start" type="date" value={form.starts_on} onChange={(e) => change("starts_on", e.target.value)} required /></div>
              <div><Label htmlFor="membership-price">מחיר חודשי</Label><Input id="membership-price" type="number" min="0" step="0.01" value={form.monthly_price} onChange={(e) => change("monthly_price", e.target.value)} required /></div>
              <div><Label htmlFor="membership-billing-day">יום חיוב</Label><Input id="membership-billing-day" type="number" min="1" max="28" value={form.billing_day} onChange={(e) => change("billing_day", e.target.value)} required /></div>
            </div>
          </section>

          <div><Label htmlFor="member-notes">הערות</Label><Textarea id="member-notes" value={form.notes} onChange={(e) => change("notes", e.target.value)} rows={2} /></div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={saving}>{saving ? "רושם..." : "רישום משתתף"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
