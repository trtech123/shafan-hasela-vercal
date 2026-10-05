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
import { attendancePaymentState, buildCancellationPreview } from "@/lib/clubDomain";

const weekdays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const membershipLabels = {
  pending_enrollment: "ממתינה להרשמה",
  active: "פעילה",
  paused: "מוקפאת",
  cancellation_scheduled: "ביטול מתוזמן",
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
const currentIsraelDate = () => {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export default function Clubs() {
  const [clubs, setClubs] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [rules, setRules] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [followUps, setFollowUps] = useState([]);
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
    const [clubsResult, instructorsResult, rulesResult, membershipsResult, attendanceResult, followUpsResult] = await Promise.all([
      supabase.from("clubs").select("*, instructor:instructors(id, full_name)").order("created_at", { ascending: false }),
      supabase.from("instructors").select("id, full_name, status").order("full_name"),
      supabase.from("club_schedule_rules").select("*").order("weekday"),
      supabase.from("club_memberships").select("*, participant:club_participants(*), agreement:recurring_agreements(id, status, provider_recurring_id, last_charge_number)").order("created_at", { ascending: false }),
      supabase.from("club_attendance_operations").select("*").order("session_date", { ascending: false }),
      supabase.from("club_payment_follow_ups").select("*").order("created_at", { ascending: false }),
    ]);

    const failure = [clubsResult, instructorsResult, rulesResult, membershipsResult, attendanceResult, followUpsResult].find((result) => result.error);
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
    setAttendanceRows(attendanceResult.data ?? []);
    setFollowUps(followUpsResult.data ?? []);
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
  const selectedAttendance = attendanceRows.filter((row) => row.club_id === selectedClubId);
  const selectedFollowUps = followUps.filter((followUp) => selectedMemberships.some((membership) => membership.id === followUp.membership_id));

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
      const requestedOn = currentIsraelDate();
      const { data, error } = await supabase.rpc("request_club_membership_cancellation", {
        p_membership_id: membership.id,
        p_requested_on: requestedOn,
      });
      if (error) throw error;
      toast.success(`הביטול נקלט וייכנס לתוקף ב־${data.effective_on}`);
      setCancellingMembership(null);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שמירת בקשת הביטול נכשלה");
      setCancellingMembership(null);
    } finally {
      setBusyId(null);
    }
  };

  const finalizeDueCancellation = async (membership) => {
    setBusyId(membership.id);
    try {
      const { data, error } = await supabase.functions.invoke("club-recurring-cancel", { body: { membershipId: membership.id } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "ביטול iCredit נכשל");
      toast.success("iCredit אישר את הביטול והחברות נסגרה");
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ביטול iCredit נכשל");
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
          <button type="button" className="mt-3 block w-full text-sm font-semibold underline" onClick={() => {
            const demo = demoClubsData();
            setClubs(demo.clubs); setInstructors(demo.instructors); setRules(demo.rules);
            setMemberships(demo.memberships); setAttendanceRows(demo.attendance); setFollowUps(demo.followUps);
            setSelectedClubId("demo-club"); setLoadError("");
          }}>פתיחת תצוגת הדגמה ללא מסד נתונים</button>
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
            <a href="/club-attendance" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 font-semibold hover:bg-white/25"><CalendarDays className="h-4 w-4" />מפגשים ונוכחות</a>
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
                    <span className="flex items-center gap-1.5 font-semibold text-amber-700"><CalendarDays className="h-4 w-4" />חיוב קבוע ב־15 עבור החודש הנוכחי</span>
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
                        <p className="text-xs font-semibold text-emerald-700">משתתף / ילד</p>
                        <h3 className="font-bold">{name}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-semibold text-slate-700">הורה / משלם: {participant.payer_name || participant.primary_contact_name || "לא הוזן"}</span>
                          {participant.payer_phone || participant.primary_contact_phone ? ` · ${participant.payer_phone || participant.primary_contact_phone}` : ""}
                          {participant.payer_email || participant.primary_contact_email ? ` · ${participant.payer_email || participant.primary_contact_email}` : ""}
                        </p>
                      </div>
                      <div className="text-sm">
                        <p className="font-semibold">{membershipLabels[membership.status] || membership.status}</p>
                        <p className="text-xs text-muted-foreground">₪{formatMoney(membership.monthly_price)} · חיוב ב־15 עבור אותו חודש</p>
                        <p className="text-xs text-muted-foreground">הוראת קבע מתחילה: {membership.recurring_starts_on || "בחודש הבא"}</p>
                        {membership.current_month_settlement_status === "manual_required" && <p className="mt-1 text-xs font-semibold text-amber-700">החודש הנוכחי: הסדרה ידנית בקופה · ללא חיוב יחסי</p>}
                        {membership.cancellation_effective_on && <p className="mt-1 text-xs font-semibold text-red-700">בקשת ביטול: {String(membership.cancellation_requested_at || "").slice(0, 10)} · סיום אפקטיבי: {membership.cancellation_effective_on}</p>}
                      </div>
                      <div className="text-sm">
                        <p className={cn("font-semibold", debt > 0 ? "text-red-700" : "text-emerald-700")}>{paymentLabels[membership.payment_status] || membership.payment_status}</p>
                        {debt > 0 ? <p className="text-xs font-bold text-red-700">חוב ₪{formatMoney(debt)}</p> : <p className="text-xs text-muted-foreground">אין חוב פתוח</p>}
                      </div>
                      <div className="flex flex-wrap gap-2 xl:justify-end">
                        {membership.status === "cancellation_scheduled" && membership.cancellation_effective_on <= currentIsraelDate() && (
                          <Button size="sm" variant="destructive" disabled={busyId === membership.id} onClick={() => finalizeDueCancellation(membership)}>השלמת ביטול ב־iCredit</Button>
                        )}
                        {!agreement?.provider_recurring_id && !["cancelled", "cancellation_scheduled"].includes(membership.status) && (
                          <Button size="sm" className="gap-1.5 bg-amber-400 text-emerald-950 hover:bg-amber-300" disabled={busyId === membership.id} onClick={() => startEnrollment(membership)} aria-label={`התחלת הוראת קבע עבור ${name}`}>
                            <CreditCard className="h-4 w-4" /> הוראת קבע
                          </Button>
                        )}
                        {!["cancelled", "cancellation_scheduled"].includes(membership.status) && (
                          <Button size="sm" variant="outline" disabled={busyId === membership.id} onClick={() => setCancellingMembership(membership)} aria-label={`ביטול חברות עבור ${name}`}>ביטול</Button>
                        )}
                      </div>
                    </article>
                  );
                })}
                {!selectedMemberships.length && <div className="p-10 text-center text-sm text-muted-foreground">עדיין אין משתתפים בחוג הזה.</div>}
              </div>
            </section>

            <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
              <div className="border-b p-5"><h2 className="text-lg font-bold">נוכחות וסטטוס תשלום iCredit</h2><p className="text-sm text-muted-foreground">הסימון הכספי נגזר מנתוני הספק ואינו ניתן לעריכה ידנית.</p></div>
              <div className="divide-y">
                {selectedAttendance.map((row) => {
                  const payment = attendancePaymentState(row.provider_charge_status);
                  return <div key={`${row.session_id}-${row.membership_id}`} className="grid gap-2 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                    <div><p className="font-semibold">{row.participant_name}</p><p className="text-xs text-muted-foreground">{row.session_date} · {time(row.start_time)}</p></div>
                    <p className="text-sm">נוכחות: {row.attendance_status === "present" ? "נוכח/ת" : row.attendance_status === "absent" ? "נעדר/ת" : "טרם סומן"}</p>
                    <span className={cn("rounded-full px-3 py-1 text-sm font-bold", payment.state === "settled" ? "bg-emerald-100 text-emerald-800" : payment.state === "failed" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700")}>{payment.symbol} {payment.label}</span>
                  </div>;
                })}
                {!selectedAttendance.length && <p className="p-6 text-sm text-muted-foreground">אין עדיין מפגשים להצגת נוכחות.</p>}
              </div>
            </section>

            <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
              <div className="border-b p-5"><h2 className="text-lg font-bold">מעקב תשלומים שנכשלו</h2><p className="text-sm text-muted-foreground">נוצר אוטומטית פעם אחת לכל חיוב שנכשל. לא נשלחת הודעה אוטומטית.</p></div>
              <div className="divide-y">
                {selectedFollowUps.map((item) => <div key={item.id} className="p-4"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">הורה / משלם: {item.payer_name || "לא ידוע"}</p><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">{item.status === "resolved" ? "טופל" : item.status === "contacted" ? "נוצר קשר" : "ממתין לטיפול"} · לא נשלח</span></div><p className="mt-2 text-sm text-muted-foreground">{item.payer_phone} {item.payer_email}</p><p className="mt-2 text-sm">{item.message}</p></div>)}
                {!selectedFollowUps.length && <p className="p-6 text-sm text-muted-foreground">אין תשלומים שנכשלו הממתינים לטיפול.</p>}
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
            <AlertDialogTitle>תזמון ביטול חברות</AlertDialogTitle>
            <AlertDialogDescription>{cancellingMembership ? `בקשה היום תסיים את החברות החל מ־${buildCancellationPreview(currentIsraelDate()).effectiveOn}. עד יום 10: החודש הבא; אחרי יום 10: החודש שאחריו. ביטול הספק יבוצע provider-first במועד האפקטיבי, ללא החזר אוטומטי.` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>חזרה</AlertDialogCancel>
            <AlertDialogAction onClick={cancelMembership} className="bg-red-700 hover:bg-red-800">שמירת בקשת ביטול</AlertDialogAction>
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

function demoClubsData() {
  return {
    clubs: [{ id: "demo-club", name: "חוג טיפוס נוער — הדגמה", description: "נתוני הדגמה לתצוגה מקדימה בלבד", instructor_id: "demo-instructor", instructor: { id: "demo-instructor", full_name: "נועה מדריכה" }, site: "עכו", monthly_price: 245, default_billing_day: 15, status: "active" }],
    instructors: [{ id: "demo-instructor", full_name: "נועה מדריכה" }],
    rules: [{ id: "demo-rule", club_id: "demo-club", weekday: 1, start_time: "16:00", end_time: "17:30", is_active: true }],
    memberships: [
      { id: "demo-paid", club_id: "demo-club", monthly_price: 245, billing_day: 15, status: "active", payment_status: "current", debt_amount: 0, recurring_starts_on: "2026-10-01", current_month_settlement_status: "manual_required", participant: { first_name: "נועה", last_name: "לוי", payer_name: "רונית לוי", payer_phone: "050-1234567", payer_email: "parent@example.com" }, agreement: { id: "demo-agreement", provider_recurring_id: "demo" } },
      { id: "demo-failed", club_id: "demo-club", monthly_price: 245, billing_day: 15, status: "cancellation_scheduled", payment_status: "past_due", debt_amount: 245, recurring_starts_on: "2026-09-01", current_month_settlement_status: "not_required", cancellation_requested_at: "2026-09-11", cancellation_effective_on: "2026-11-01", participant: { first_name: "דן", last_name: "כהן", payer_name: "אייל כהן", payer_phone: "052-7654321", payer_email: "eyal@example.com" }, agreement: { id: "demo-agreement-2", provider_recurring_id: "demo-2" } },
    ],
    attendance: [
      { session_id: "demo-session", membership_id: "demo-paid", club_id: "demo-club", participant_name: "נועה לוי", session_date: "2026-09-07", start_time: "16:00", attendance_status: "present", provider_charge_status: "succeeded" },
      { session_id: "demo-session", membership_id: "demo-failed", club_id: "demo-club", participant_name: "דן כהן", session_date: "2026-09-07", start_time: "16:00", attendance_status: "absent", provider_charge_status: "failed" },
      { session_id: "demo-session-2", membership_id: "demo-paid", club_id: "demo-club", participant_name: "משתתף ללא אימות", session_date: "2026-10-05", start_time: "16:00", attendance_status: null, provider_charge_status: null },
    ],
    followUps: [{ id: "demo-follow-up", membership_id: "demo-failed", payer_name: "אייל כהן", payer_phone: "052-7654321", payer_email: "eyal@example.com", status: "pending", delivery_status: "not_sent", message: "שלום אייל כהן, התשלום נכשל. יש לפנות למשרד כדי לעדכן או להסדיר את כרטיס האשראי הרלוונטי." }],
  };
}
