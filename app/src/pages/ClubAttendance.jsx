import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ClipboardList } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { attendanceError, attendanceLabels, israelDate, sessionLabels, shiftDate, validAttendanceRange } from '@/lib/clubAttendance';

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
const clock = value => String(value || '').slice(0, 5);
const dateLabel = value => value ? value.split('-').reverse().join('.') : '—';
const timestamp = value => value ? new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

export default function ClubAttendance() {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <div role="alert" dir="rtl">אין הרשאה לצפייה בנוכחות חוגים.</div>;
  return <AttendanceWorkspace />;
}

function AttendanceWorkspace() {
  const [clubs, setClubs] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [clubId, setClubId] = useState('');
  const [from, setFrom] = useState(() => shiftDate(israelDate(), -14));
  const [until, setUntil] = useState(() => shiftDate(israelDate(), 14));
  const [loadedRange, setLoadedRange] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [audit, setAudit] = useState([]);
  const [sessionAudit, setSessionAudit] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const request = useRef(0);
  const auditRequest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const results = await Promise.all([
          supabase.from('clubs').select('id,name,status').order('name'),
          supabase.from('instructors').select('id,full_name').order('full_name'),
        ]);
        if (results.some(r => r.error)) throw results.find(r => r.error).error;
        if (!mounted.current) return;
        setClubs(results[0].data || []); setInstructors(results[1].data || []);
        setClubId(results[0].data?.[0]?.id || '');
      } catch (e) { if (mounted.current) setError(attendanceError(e)); }
      finally { if (mounted.current) setLoading(false); }
    })();
    return () => { mounted.current = false; request.current++; auditRequest.current++; };
  }, []);

  async function load(id = clubId, start = from, end = until) {
    if (!id || !validAttendanceRange(start, end)) { setError('יש לבחור טווח תקין של עד 62 ימים.'); return; }
    const sequence = ++request.current;
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        supabase.from('club_sessions').select('id,club_id,session_date,start_time,end_time,status,instructor_id,instructor_name,notes,version')
          .eq('club_id', id).gte('session_date', start).lte('session_date', end).order('session_date').order('start_time'),
        supabase.rpc('get_club_attendance_history', { p_club_id: id, p_from: start, p_until: end }),
      ]);
      if (s.error || h.error) throw s.error || h.error;
      if (!mounted.current || sequence !== request.current) return;
      setSessions(s.data || []); setRows(h.data || []); setLoadedRange({ id, start, end });
      setSelectedId(current => (s.data || []).some(session => session.id === current) ? current : '');
    } catch (e) {
      if (mounted.current && sequence === request.current) { setError(attendanceError(e)); setSessions([]); setRows([]); setLoadedRange(null); }
    } finally { if (mounted.current && sequence === request.current) setLoading(false); }
  }
  useEffect(() => {
    setSelectedId(''); setParticipantId(''); setAudit([]); setSessionAudit([]); auditRequest.current++;
    if (clubId) void load(clubId);
    // Range edits are drafts until the explicit refresh action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  async function loadAudit(id) {
    const sequence = ++auditRequest.current;
    setAudit([]); setSessionAudit([]);
    try {
      const [a, s] = await Promise.all([
        supabase.from('club_attendance_audit').select('id,membership_id,old_status,new_status,old_notes,new_notes,version,actor_name,changed_at').eq('session_id', id).order('id', { ascending: false }),
        supabase.from('club_session_audit').select('id,old_status,new_status,old_notes,new_notes,version,actor_name,changed_at').eq('session_id', id).order('id', { ascending: false }),
      ]);
      if (a.error || s.error) throw a.error || s.error;
      if (mounted.current && sequence === auditRequest.current) { setAudit(a.data || []); setSessionAudit(s.data || []); }
    } catch (e) { if (mounted.current && sequence === auditRequest.current) setError(attendanceError(e)); }
  }
  async function write(name, params, success) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await supabase.rpc(name, params);
      if (result.error) throw result.error;
      setNotice(name === 'materialize_club_sessions' ? `נוצרו ${result.data} מפגשים חדשים. מפגשים קיימים נשמרו.` : success);
    } catch (e) { setError(attendanceError(e)); }
    finally {
      // Even a network timeout may have committed. Read current state before retrying.
      await load(); if (selectedId) await loadAudit(selectedId);
      mutation.current = false; setBusy(false);
    }
  }
  const selected = sessions.find(s => s.id === selectedId);
  const rangeChanged = !loadedRange || loadedRange.id !== clubId || loadedRange.start !== from || loadedRange.end !== until;
  const locked = busy || loading || rangeChanged;
  const readonly = locked || selected?.status === 'cancelled' || selected?.session_date > israelDate();
  const roster = rows.filter(r => r.session_id === selectedId);
  const participants = Array.from(new Map(rows.map(r => [r.participant_id, r.participant_name])).entries());
  const history = rows.filter(r => (!participantId || r.participant_id === participantId) && r.participant_name.includes(search.trim()));

  return <div dir="rtl" className="space-y-6 min-w-0 text-card-foreground">
    <header className="rounded-2xl bg-emerald-950 p-5 text-white space-y-2">
      <h1 className="flex items-center gap-2 text-2xl font-bold"><ClipboardList aria-hidden="true" />נוכחות חוגים</h1>
      <p className="text-sm text-emerald-100">מפגשים, רשימות משתתפים והיסטוריית נוכחות · שעון ישראל</p>
      <a href="/clubs" className="inline-block underline text-sm">ניהול חוגים והמערכת השבועית</a>
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
    <section aria-label="בחירת חוג וטווח" className="rounded-xl border bg-card p-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1">חוג<select aria-label="חוג" className={selectClass} value={clubId} disabled={busy || loading} onChange={e => { setError(''); setClubId(e.target.value); }}>
          {!clubs.length && <option value="">אין חוגים להצגה</option>}
          {clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <label className="space-y-1">מתאריך<Input aria-label="מתאריך" type="date" value={from} disabled={busy} onChange={e => setFrom(e.target.value)} /></label>
        <label className="space-y-1">עד תאריך<Input aria-label="עד תאריך" type="date" value={until} disabled={busy} onChange={e => setUntil(e.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy || loading || !clubId} variant="outline" onClick={() => { setError(''); void load(); }}>רענון מפגשים</Button>
        <Button disabled={busy || loading || !clubId || !validAttendanceRange(from, until) || clubs.find(c => c.id === clubId)?.status !== 'active'} onClick={() => write('materialize_club_sessions', { p_club_id: clubId, p_from: from, p_until: until }, '')}>יצירת מפגשים מהמערכת השבועית</Button>
      </div>
      <p className="text-sm text-muted-foreground">עד 62 ימים בכל טעינה. יצירה עד שנה לאחור ועד 90 ימים קדימה. שינוי במערכת השבועית אינו משנה מפגשים שנוצרו; יש לבטל בנפרד מפגש שהוחלף. טעינה ורענון אינם יוצרים מפגשים.</p>
      {loadedRange && rangeChanged && <p role="status" className="text-amber-800">הטווח השתנה. לחצו על רענון מפגשים להצגת הנתונים בטווח החדש.</p>}
    </section>
    {loading && <p role="status">טוען נתונים…</p>}
    {!loading && !!clubId && !sessions.length && <p>אין מפגשים בטווח שנבחר</p>}
    <section aria-label="מפגשים" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {sessions.map(s => <article key={s.id} className={`rounded-xl border p-4 bg-card space-y-2 ${s.id === selectedId ? 'ring-2 ring-emerald-600' : ''}`}>
        <h2 className="font-bold flex items-center gap-2"><CalendarDays className="h-4 w-4" />{dateLabel(s.session_date)} · <span dir="ltr">{clock(s.start_time)}–{clock(s.end_time)}</span></h2>
        <p>{sessionLabels[s.status]} · {s.instructor_name || 'טרם שובץ מדריך'}</p>
        <Button variant="outline" disabled={locked} aria-label={`פתיחת מפגש ${s.session_date} ${clock(s.start_time)}`} onClick={() => { setSelectedId(s.id); void loadAudit(s.id); }}>פתיחת מפגש</Button>
      </article>)}
    </section>
    {selected && <section aria-label="נוכחות במפגש" className="rounded-xl border bg-card p-4 space-y-4">
      <h2 className="font-bold text-xl">נוכחות · {dateLabel(selected.session_date)} · {clock(selected.start_time)}</h2>
      <SessionEditor key={`${selected.id}-${selected.version}`} session={selected} instructors={instructors} disabled={locked || selected.status === 'cancelled'} save={(status, instructor, notes) => write('update_club_session', { p_session_id: selected.id, p_expected_version: selected.version, p_status: status, p_instructor_id: instructor || null, p_notes: notes }, 'המפגש עודכן.')} />
      <Button variant="outline" disabled={locked || selected.status === 'cancelled'} onClick={() => write('prepare_club_roster', { p_session_id: selected.id }, 'רשימת המשתתפים עודכנה. רשומות קודמות נשמרו.')}>פתיחה / עדכון רשימת משתתפים</Button>
      <p className="text-sm text-muted-foreground">הרשימה נשמרת במפורש לפי תאריכי החברות. רענון רשימה מוסיף זכאים ואינו מוחק היסטוריה. חברות מושהית אינה נכללת; מצב התשלום אינו משפיע. ללא סימון פירושו שטרם נרשמה נוכחות.</p>
      {selected.session_date > israelDate() && <p>סימון נוכחות ייפתח ביום המפגש.</p>}
      {!roster.length && <p>אין משתתפים ברשימת המפגש. פתחו את הרשימה או בדקו את תאריכי החברות בחוג.</p>}
      {roster.map(r => <AttendanceRow key={`${r.membership_id}-${r.version}`} row={r} disabled={readonly} save={(status, notes) => write('mark_club_attendance', { p_session_id: selected.id, p_membership_id: r.membership_id, p_status: status, p_expected_version: r.version, p_notes: notes }, 'הנוכחות נשמרה.')} />)}
      <details><summary className="cursor-pointer font-semibold">יומן שינויים במפגש ובנוכחות</summary>
        {!audit.length && !sessionAudit.length && <p className="py-2">אין שינויים מתועדים במפגש זה.</p>}
        {audit.map(a => <p key={`a-${a.id}`} className="py-2 text-sm border-b">{timestamp(a.changed_at)} · {a.actor_name || 'משתמש לא זמין'} · {roster.find(r => r.membership_id === a.membership_id)?.participant_name || 'משתתף'} · {attendanceLabels[a.old_status] || 'טרם סומן'} ← {attendanceLabels[a.new_status]} · {a.new_notes || 'ללא הערה'}</p>)}
        {sessionAudit.map(a => <p key={`s-${a.id}`} className="py-2 text-sm border-b">{timestamp(a.changed_at)} · {a.actor_name || 'משתמש לא זמין'} · עדכון מפגש: {sessionLabels[a.old_status]} ← {sessionLabels[a.new_status]} · {a.new_notes || 'ללא הערה'}</p>)}
      </details>
    </section>}
    <section aria-label="היסטוריית נוכחות" className="rounded-xl border bg-card p-4 space-y-3">
      <h2 className="text-xl font-bold">היסטוריית נוכחות בטווח שנבחר</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input aria-label="חיפוש משתתף" placeholder="חיפוש לפי שם משתתף" value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label="סינון משתתף" className={selectClass} value={participantId} onChange={e => setParticipantId(e.target.value)}><option value="">כל המשתתפים</option>{participants.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      </div>
      {!history.length && <p>אין רשומות נוכחות להצגה בטווח ובסינון שנבחרו.</p>}
      {history.map(r => <div key={`${r.session_id}-${r.membership_id}`} className="rounded-lg border p-3 flex flex-wrap justify-between gap-2 text-sm">
        <span>{r.participant_name} · {dateLabel(r.session_date)} · {clock(r.start_time)}</span>
        <span>{sessionLabels[r.session_status]} · {attendanceLabels[r.status] || 'טרם סומן'}</span>
        <span>{r.actor_name || '—'} · {timestamp(r.updated_at)}</span>
      </div>)}
    </section>
  </div>;
}

function AttendanceRow({ row, disabled, save }) {
  const [notes, setNotes] = useState(row.notes || '');
  return <article className="rounded-xl border p-3 space-y-3">
    <h3 className="font-bold">{row.participant_name} <span className="font-normal text-sm">· {attendanceLabels[row.status] || 'טרם סומן'}</span></h3>
    <p className="text-xs text-muted-foreground">עדכון אחרון: {row.actor_name || '—'} · {timestamp(row.updated_at)}</p>
    <Input aria-label={`הערה עבור ${row.participant_name}`} placeholder="הערה / סיבת תיקון (רשות)" maxLength={1000} value={notes} disabled={disabled} onChange={e => setNotes(e.target.value)} />
    <div className="flex flex-wrap gap-2">{Object.entries(attendanceLabels).map(([status, label]) => <Button key={status} disabled={disabled} aria-pressed={row.status === status} variant={row.status === status ? 'default' : 'outline'} onClick={() => save(status, notes)}>{label}</Button>)}</div>
  </article>;
}

function SessionEditor({ session, instructors, disabled, save }) {
  const [instructor, setInstructor] = useState(session.instructor_id || '');
  const [status, setStatus] = useState(session.status);
  const [notes, setNotes] = useState(session.notes || '');
  return <div className="space-y-3 rounded-lg bg-muted/40 p-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label>מדריך למפגש<select aria-label="מדריך למפגש" className={selectClass} value={instructor} disabled={disabled} onChange={e => setInstructor(e.target.value)}><option value="">ללא שיבוץ</option>{instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}</select></label>
      <label>מצב מפגש<select aria-label="מצב מפגש" className={selectClass} value={status} disabled={disabled} onChange={e => setStatus(e.target.value)}>{Object.entries(sessionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <Input aria-label="הערת מפגש" placeholder="הערת מפגש / סיבת ביטול" maxLength={1000} value={notes} disabled={disabled} onChange={e => setNotes(e.target.value)} />
    <Button variant="outline" disabled={disabled} onClick={() => { if (status !== 'cancelled' || window.confirm('לבטל את המפגש? ההיסטוריה תישמר ולא ניתן יהיה לפתוח אותו מחדש.')) save(status, instructor, notes); }}>שמירת פרטי מפגש</Button>
  </div>;
}
