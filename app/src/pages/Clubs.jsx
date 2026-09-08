import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Banknote,
  CalendarDays,
  CircleAlert,
  CreditCard,
  MapPin,
  Pencil,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import ClubFormDialog from "@/components/clubs/ClubFormDialog";
import MemberRegistrationDialog from "@/components/clubs/MemberRegistrationDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const weekdays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const membershipLabels = {
  pending_enrollment: "ממתינה להרשמה",
  active: "פעילה",
  paused: "מוקפאת",
  cancelled: "בוטלה",
  ended: "הסתיימה",
};

const paymentLabels = {
  not_enrolled: "טרם הוגדר תשלום",
  current: "תקין",
  past_due: "בפיגור",
  cancelled: "בוטל",
};

const relationOne = (value) => Array.isArray(value) ? value[0] : value;
const participantName = (membership) => {
  const participant = relationOne(membership.participant);
  return [participant?.first_name, participant?.last_name].filter(Boolean).join(" ");
};
const formatMoney = (amount) => new Intl.NumberFormat("he-IL", {
  maximumFractionDigits: 2,
}).format(Number(amount || 0));
const time = (value) => String(value || "").slice(0, 5);

export default function Clubs() {
  const [clubs, setClubs] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [rules, setRules] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [selectedClubId, setSelectedClubId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [clubDialog, setClubDialog] = useState({ open: false, club: null });
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [cancellingMembership, setCancellingMembership] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const [clubsResult, instructorsResult, rulesResult, membershipsResult] = await Promise.all([
      supabase.from("clubs").select("*, instructor:instructors(id, full_name)").order("created_at", { ascending: false }),
      supabase.from("instructors").select("id, full_name, status").order("full_name"),
      supabase.from("club_schedule_rules").select("*").order("weekday"),
      supabase.from("club_memberships").select("*, participant:club_participants(*), agreement:recurring_agreements(id, status, provider_recurring_id, last_charge_number)").order("created_at", { ascending: false }),
    ]);

    const failure = [clubsResult, instructorsResult, rulesResult, membershipsResult].find((result) => result.error);
    if (failure) {
      toast.error("שגיאה בטעינת החוגים");
      setLoadError("לא ניתן לטעון את נתוני החוגים. ייתכן שמסד הנתונים טרם עודכן.");
      setLoading(false);
      return;
    }

    const loadedClubs = clubsResult.data ?? [];
    setClubs(loadedClubs);
    setInstructors(instructorsResult.data ?? []);
    setRules(rulesResult.data ?? []);
    setMemberships(membershipsResult.data ?? []);
    setSelectedClubId((current) => loadedClubs.some((club) => club.id === current)
      ? current
      : loadedClubs[0]?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredClubs = useMemo(() => clubs.filter((club) =>
    club.name.toLowerCase().includes(search.trim().toLowerCase())), [clubs, search]);
  const selectedClub = clubs.find((club) => club.id === selectedClubId) ?? null;
  const selectedRules = rules.filter((rule) => rule.club_id === selectedClubId && rule.is_active !== false);
  const selectedMemberships = memberships.filter((membership) => membership.club_id === selectedClubId);
  const activeCount = selectedMemberships.filter((membership) => membership.status === "active").length;
  const debtTotal = selectedMemberships.reduce((sum, membership) => sum + Number(membership.debt_amount || 0), 0);

  const startEnrollment = async (membership) => {
    setBusyId(membership.id);
    try {
      const { data, error } = await supabase.functions.invoke("club-recurring-enroll", {
        body: { membershipId: membership.id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "יצירת קישור התשלום נכשלה");
      const enrollmentUrl = new URL(data.url);
      if (enrollmentUrl.protocol !== "https:" || enrollmentUrl.hostname !== "testicredit.rivhit.co.il") {
        throw new Error("כתובת התשלום שהתקבלה אינה כתובת iCredit TEST מאושרת");
      }
      window.open(enrollmentUrl.toString(), "_blank", "noopener,noreferrer");
      toast.success("עמוד ההרשמה המאובטח נפתח בחלון חדש");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "יצירת קישור התשלום נכשלה");
    } finally {
      setBusyId(null);
    }
  };

  const cancelMembership = async () => {
    const membership = cancellingMembership;
    if (!membership) return;
    setBusyId(membership.id);
    try {
      const agreement = relationOne(membership.agreement);
      if (agreement?.id) {
        const { data, error } = await supabase.functions.invoke("club-recurring-cancel", {
          body: { membershipId: membership.id },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "ביטול הוראת הקבע נכשל");
      } else {
        const { error } = await supabase.from("club_memberships").update({
          status: "cancelled",
          payment_status: "cancelled",
          cancelled_at: new Date().toISOString(),
          ends_on: new Date().toISOString().slice(0, 10),
        }).eq("id", membership.id);
        if (error) throw error;
      }
      toast.success("החברות בוטלה");
      setCancellingMembership(null);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ביטול החברות נכשל");
      setCancellingMembership(null);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-700" /></div>;
  }

  if (loadError) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center" dir="rtl">
        <div role="alert" className="max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-800 shadow-sm">
          <CircleAlert className="mx-auto h-8 w-8" />
          <h1 className="mt-3 text-lg font-bold">לא ניתן לטעון את נתוני החוגים</h1>
          <p className="mt-2 text-sm">ייתכן שמסד הנתונים טרם עודכן. המסך זמין, אך הנתונים אינם נגישים כרגע.</p>
          <Button type="button" variant="outline" className="mt-4 border-red-300 bg-white" onClick={loadData}>
            נסה שוב
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <header className="relative overflow-hidden rounded-3xl bg-[linear-gradient(120deg,#123d2b,#1e5a3e_58%,#b97720)] px-6 py-7 text-white shadow-lg md:px-8">
        <div className="absolute -left-12 -top-20 h-48 w-48 rounded-full border border-white/10" />
        <div className="absolute bottom-0 left-16 h-20 w-20 rounded-t-full bg-white/5" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.22em] text-amber-200">מועדון · קהילה · תשלום חודשי</p>
            <h1 className="text-3xl font-black tracking-tight md:text-4xl">חוגים ומנויים</h1>
            <p className="mt-2 max-w-xl text-sm text-emerald-50/80">ניהול מערכת שבועית, משתתפים וחיובים חוזרים — בלי ליצור הזמנה לכל מפגש.</p>
          </div>
          <Button className="gap-2 bg-amber-400 text-emerald-950 hover:bg-amber-300" onClick={() => setClubDialog({ open: true, club: null })}>
            <Plus className="h-4 w-4" /> חוג חדש
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="relative">
            <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input aria-label="חיפוש חוג" className="pr-9" placeholder="חיפוש חוג..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div className="space-y-2">
            {filteredClubs.map((club) => {
              const count = memberships.filter((membership) => membership.club_id === club.id && membership.status === "active").length;
              return (
                <button key={club.id} type="button" onClick={() => setSelectedClubId(club.id)} className={cn(
                  "w-full rounded-2xl border bg-card p-4 text-right shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                  selectedClubId === club.id && "border-emerald-600 ring-2 ring-emerald-600/10",
                )}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-bold">{club.name}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{relationOne(club.instructor)?.full_name || "טרם שובץ מדריך"}</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{count} פעילים</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {selectedClub ? (
          <main className="space-y-5">
            <section className="rounded-3xl border bg-card p-5 shadow-sm md:p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-black">{selectedClub.name}</h2>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", selectedClub.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>{selectedClub.status === "active" ? "פעיל" : "לא פעיל"}</span>
                  </div>
                  {selectedClub.description && <p className="mt-2 text-sm text-muted-foreground">{selectedClub.description}</p>}
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 text-emerald-600" />{relationOne(selectedClub.instructor)?.full_name || "ללא מדריך"}</span>
                    {selectedClub.site && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-amber-600" />{selectedClub.site}</span>}
                    <span className="flex items-center gap-1.5"><Banknote className="h-4 w-4 text-emerald-600" />₪{formatMoney(selectedClub.monthly_price)} לחודש</span>
                  </div>
                </div>
                <Button variant="outline" className="gap-2" onClick={() => setClubDialog({ open: true, club: selectedClub })}>
                  <Pencil className="h-4 w-4" /> עריכת חוג
                </Button>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <Metric icon={Users} label="חברויות פעילות" value={activeCount} />
                <Metric icon={CalendarDays} label="מפגשים בשבוע" value={selectedRules.length} />
                <Metric icon={CircleAlert} label="חוב פתוח" value={`₪${formatMoney(debtTotal)}`} alert={debtTotal > 0} />
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {selectedRules.map((rule) => (
                  <span key={rule.id} className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-sm font-medium text-emerald-900">
                    יום {weekdays[rule.weekday]} · {time(rule.start_time)}–{time(rule.end_time)}
                  </span>
                ))}
                {!selectedRules.length && <p className="text-sm text-muted-foreground">טרם הוגדרה מערכת שבועית.</p>}
              </div>
            </section>

            <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
              <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold">משתתפים וחברויות</h2>
                  <p className="text-sm text-muted-foreground">מחיר החברות נשמר בעת ההרשמה ואינו משתנה עם מחיר החוג.</p>
                </div>
                <Button className="gap-2 bg-emerald-700 hover:bg-emerald-800" onClick={() => setRegistrationOpen(true)}>
                  <Plus className="h-4 w-4" /> רישום משתתף
                </Button>
              </div>
              <div className="divide-y">
                {selectedMemberships.map((membership) => {
                  const participant = relationOne(membership.participant) || {};
                  const agreement = relationOne(membership.agreement);
                  const name = participantName(membership);
                  const debt = Number(membership.debt_amount || 0);
                  return (
                    <article key={membership.id} className="grid gap-4 p-5 xl:grid-cols-[1.4fr_1fr_1fr_auto] xl:items-center">
                      <div>
                        <h3 className="font-bold">{name}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {participant.primary_contact_name ? `איש קשר: ${participant.primary_contact_name}` : "משתתף עצמאי"}
                          {participant.primary_contact_phone || participant.phone ? ` · ${participant.primary_contact_phone || participant.phone}` : ""}
                        </p>
                      </div>
                      <div className="text-sm">
                        <p className="font-semibold">{membershipLabels[membership.status] || membership.status}</p>
                        <p className="text-xs text-muted-foreground">₪{formatMoney(membership.monthly_price)} · חיוב ב־{membership.billing_day} בחודש</p>
                      </div>
                      <div className="text-sm">
                        <p className={cn("font-semibold", debt > 0 ? "text-red-700" : "text-emerald-700")}>{paymentLabels[membership.payment_status] || membership.payment_status}</p>
                        {debt > 0 ? <p className="text-xs font-bold text-red-700">חוב ₪{formatMoney(debt)}</p> : <p className="text-xs text-muted-foreground">אין חוב פתוח</p>}
                      </div>
                      <div className="flex flex-wrap gap-2 xl:justify-end">
                        {!agreement?.provider_recurring_id && membership.status !== "cancelled" && (
                          <Button size="sm" className="gap-1.5 bg-amber-400 text-emerald-950 hover:bg-amber-300" disabled={busyId === membership.id} onClick={() => startEnrollment(membership)} aria-label={`התחלת הוראת קבע עבור ${name}`}>
                            <CreditCard className="h-4 w-4" /> הוראת קבע
                          </Button>
                        )}
                        {membership.status !== "cancelled" && (
                          <Button size="sm" variant="outline" disabled={busyId === membership.id} onClick={() => setCancellingMembership(membership)} aria-label={`ביטול חברות עבור ${name}`}>ביטול</Button>
                        )}
                      </div>
                    </article>
                  );
                })}
                {!selectedMemberships.length && <div className="p-10 text-center text-sm text-muted-foreground">עדיין אין משתתפים בחוג הזה.</div>}
              </div>
            </section>
          </main>
        ) : (
          <div className="rounded-3xl border border-dashed p-12 text-center text-muted-foreground">צרו את החוג הראשון כדי להתחיל.</div>
        )}
      </div>

      <ClubFormDialog
        open={clubDialog.open}
        onClose={() => setClubDialog({ open: false, club: null })}
        club={clubDialog.club}
        scheduleRules={rules.filter((rule) => rule.club_id === clubDialog.club?.id)}
        instructors={instructors}
        onSaved={loadData}
      />
      <MemberRegistrationDialog open={registrationOpen} onClose={() => setRegistrationOpen(false)} club={selectedClub} onSaved={loadData} />

      <AlertDialog open={Boolean(cancellingMembership)} onOpenChange={(open) => !open && setCancellingMembership(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>ביטול חברות מיידי</AlertDialogTitle>
            <AlertDialogDescription>הוראת הקבע תבוטל תחילה ב־iCredit TEST. החברות המקומית תבוטל רק לאחר אישור הספק.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>חזרה</AlertDialogCancel>
            <AlertDialogAction onClick={cancelMembership} className="bg-red-700 hover:bg-red-800">אישור ביטול מיידי</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ icon: Icon, label, value, alert = false }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border bg-slate-50 p-3", alert && "border-red-100 bg-red-50")}>
      <div className={cn("rounded-xl bg-white p-2 text-emerald-700 shadow-sm", alert && "text-red-700")}><Icon className="h-5 w-5" /></div>
      <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-black">{value}</p></div>
    </div>
  );
}
