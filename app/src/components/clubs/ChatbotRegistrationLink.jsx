import { useEffect, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { approvedRegistrationUrl, israelRegistrationMonth, isValidRegistrationUrl } from "../../../../supabase/functions/_shared/chatbot/registration-link.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ChatbotRegistrationLink() {
  const { user } = useAuth();
  const currentMonth = israelRegistrationMonth();
  const [month, setMonth] = useState(currentMonth);
  const [url, setUrl] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.role !== "admin") return;
    let active = true;
    supabase.from("bot_club_registration_links").select("registration_month,url").order("registration_month", { ascending: false })
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) setError("לא ניתן לטעון את קישורי ההרשמה.");
        else setRows(data ?? []);
      });
    return () => { active = false; };
  }, [user?.role]);

  if (user?.role !== "admin") return null;
  const current = approvedRegistrationUrl(rows.find((row) => row.registration_month === `${currentMonth}-01`), currentMonth);
  const selected = rows.find((row) => row.registration_month === `${month}-01`);

  async function save(event) {
    event.preventDefault();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !isValidRegistrationUrl(url)) {
      setError("יש לבחור חודש ולהזין קישור HTTPS תקין ללא פרטי כניסה או עוגן.");
      return;
    }
    setSaving(true);
    setError("");
    const row = { registration_month: `${month}-01`, url: url.trim(), updated_by: user.id };
    const result = await supabase.from("bot_club_registration_links").upsert(row, { onConflict: "registration_month" });
    if (result.error) setError("שמירת הקישור נכשלה. יש לוודא הרשאת מנהל ולנסות שוב.");
    else setRows((old) => [row, ...old.filter((item) => item.registration_month !== row.registration_month)]);
    setSaving(false);
  }

  return <section className="rounded-2xl border bg-card p-5" aria-label="קישור הרשמה חודשי לבוט">
    <h2 className="text-lg font-bold">קישור הרשמה חודשי לחוגים בצ׳אט</h2>
    <p className="mt-1 text-sm">החודש הנוכחי בישראל: {currentMonth}. {current ? "קישור מאושר זמין לחודש זה." : "אין קישור זמין לחודש זה; הבוט יעביר לנציג."}</p>
    {current && <p className="mt-1 break-all text-sm">קישור פעיל לחודש {currentMonth}: <a href={current} target="_blank" rel="noopener noreferrer" className="underline">{current}</a></p>}
    <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
      <label className="text-sm">חודש הרשמה<Input aria-label="חודש הרשמה" type="month" value={month} onChange={(event) => { const value = event.target.value; setMonth(value); setUrl(rows.find((row) => row.registration_month === `${value}-01`)?.url ?? ""); }} /></label>
      <label className="text-sm">קישור הרשמה ותשלום<Input aria-label="קישור הרשמה ותשלום" type="url" value={url} placeholder="https://" onChange={(event) => setUrl(event.target.value)} /></label>
      <Button type="submit" disabled={saving}>שמירת קישור</Button>
    </form>
    {selected && <p className="mt-2 text-sm">לחודש הנבחר כבר נשמר קישור. שמירה תחליף אותו.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </section>;
}
