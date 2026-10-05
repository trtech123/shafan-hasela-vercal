import {useEffect, useRef, useState} from 'react';
import {CalendarDays} from 'lucide-react';
import {supabase} from '@/api/supabaseClient';
import {useAuth} from '@/lib/AuthContext';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {attendanceError, israelDate, sessionLabels, shiftDate, validAttendanceRange} from '@/lib/clubAttendance';

const labels={present:'נוכח',absent:'נעדר',excused:'מוצדק'};
const dateLabel=value=>value?.split('-').reverse().join('.');
const time=value=>String(value||'').slice(0,5);
const errorLabel=e=>String(e?.message).includes('attendance_forbidden')?'אין הרשאה למפגש. ייתכן שהשיבוץ או קישור המשתמש השתנו.':attendanceError(e);

export default function InstructorAttendance(){
 const {user}=useAuth();
 if(user?.role!=='מדריך')return <p role="alert" dir="rtl">אין הרשאה למסך המדריכים.</p>;
 return <InstructorWorkspace key={user.id}/>;
}
function InstructorWorkspace(){
 const [from,setFrom]=useState(()=>shiftDate(israelDate(),-7));
 const [until,setUntil]=useState(()=>shiftDate(israelDate(),14));
 const [sessions,setSessions]=useState([]);
 const [linked,setLinked]=useState(true);
 const [selected,setSelected]=useState(null);
 const [roster,setRoster]=useState([]);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [loadedRange,setLoadedRange]=useState('');
 const request=useRef(0),mounted=useRef(true),writing=useRef(false);
 async function load(keepId=''){
  const sequence=++request.current;
  setSelected(null);setRoster([]);
  if(!validAttendanceRange(from,until)){setError('יש לבחור טווח תקין של עד 62 ימים.');return;}
  setLoading(true);
  try{
   const result=await supabase.rpc('get_instructor_club_sessions',{p_from:from,p_until:until});
   if(result.error)throw result.error;
   if(!mounted.current||sequence!==request.current)return;
   const list=result.data?.sessions||[];
   setSessions(list);setLinked(result.data?.linked===true);setLoadedRange(`${from}/${until}`);
   const current=list.find(s=>s.id===keepId);
   if(current){
    const detail=await supabase.rpc('get_instructor_club_roster',{p_session_id:current.id});
    if(detail.error)throw detail.error;
    if(mounted.current&&sequence===request.current){setSelected(current);setRoster(detail.data||[]);}
   }
  }catch(e){if(mounted.current&&sequence===request.current){setError(errorLabel(e));setSessions([]);setSelected(null);setRoster([]);}}
  finally{if(mounted.current&&sequence===request.current)setLoading(false);}
 }
 useEffect(()=>{
  mounted.current=true;void load();
  return()=>{mounted.current=false;request.current++;};
  // Dates are draft filters until explicit refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 async function open(session){
  const sequence=++request.current;setLoading(true);setError('');setNotice('');setSelected(null);setRoster([]);
  try{
   const result=await supabase.rpc('get_instructor_club_roster',{p_session_id:session.id});
   if(result.error)throw result.error;
   if(mounted.current&&sequence===request.current){setSelected(session);setRoster(result.data||[]);}
  }catch(e){if(mounted.current&&sequence===request.current){setError(errorLabel(e));setSessions([]);}}
  finally{if(mounted.current&&sequence===request.current)setLoading(false);}
 }
 async function write(name,params){
  if(writing.current)return;
  writing.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await supabase.rpc(name,params);
   if(result.error)throw result.error;
   if(mounted.current)setNotice(name==='prepare_club_roster'?'רשימת המשתתפים עודכנה.':'הנוכחות נשמרה.');
  }catch(e){if(mounted.current)setError(errorLabel(e));}
  finally{
   // Timeout may have committed. Recheck ownership and versions before retrying.
   if(mounted.current)await load(selected?.id);
   writing.current=false;if(mounted.current)setBusy(false);
  }
 }
 const rangeChanged=loadedRange!==`${from}/${until}`;
 const disabled=busy||loading||rangeChanged;
 const cannotMark=disabled||selected?.status==='cancelled'||selected?.session_date>israelDate();
 return <div dir="rtl" className="space-y-4 text-card-foreground min-w-0">
  <header className="rounded-2xl bg-emerald-950 text-white p-5 space-y-2"><h1 className="text-2xl font-bold">נוכחות בחוגים</h1><p className="text-sm">המפגשים ששובצת אליהם · שעון ישראל</p></header>
  {error&&<p role="alert" className="bg-red-50 text-red-800 p-3 rounded-xl">{error}</p>}
  {notice&&<p role="status" className="bg-emerald-50 text-emerald-900 p-3 rounded-xl">{notice}</p>}
  <section className="rounded-xl border bg-card p-4 space-y-3" aria-label="טווח מפגשים">
   <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <label>מתאריך<Input type="date" aria-label="מתאריך" disabled={busy||loading} value={from} onChange={e=>setFrom(e.target.value)}/></label>
    <label>עד תאריך<Input type="date" aria-label="עד תאריך" disabled={busy||loading} value={until} onChange={e=>setUntil(e.target.value)}/></label>
   </div>
   <Button variant="outline" disabled={busy||loading} onClick={()=>{setError('');setNotice('');void load();}}>רענון</Button>
   {!!loadedRange&&rangeChanged&&<p>הטווח השתנה. יש לרענן את רשימת המפגשים.</p>}
  </section>
  {loading&&<p role="status">טוען מפגשים ונוכחות…</p>}
  {!loading&&!linked&&<p>המשתמש טרם קושר לרשומת מדריך. יש לפנות למנהל המערכת.</p>}
  {!loading&&linked&&!sessions.length&&!error&&<p>אין מפגשים משויכים בטווח שנבחר.</p>}
  <section aria-label="המפגשים שלי" className="grid gap-3 sm:grid-cols-2">
   {sessions.map(s=><article key={s.id} className={`rounded-xl border bg-card p-4 space-y-2 ${selected?.id===s.id?'ring-2 ring-emerald-600':''}`}>
    <h2 className="font-bold text-lg">{s.club_name}</h2>
    <p className="flex gap-2 items-center"><CalendarDays className="h-4 w-4"/>{dateLabel(s.session_date)} · <span dir="ltr">{time(s.start_time)}–{time(s.end_time)}</span></p>
    <p>{sessionLabels[s.status]}</p><Button variant="outline" disabled={disabled} onClick={()=>open(s)}>פתיחת נוכחות</Button>
   </article>)}
  </section>
  {selected&&<section aria-label="רשימת משתתפים" className="rounded-xl border bg-card p-4 space-y-4">
   <h2 className="font-bold text-xl">{selected.club_name} · {dateLabel(selected.session_date)} · {time(selected.start_time)}</h2>
   {selected.status==='cancelled'&&<p>המפגש בוטל. הנוכחות מוצגת לקריאה בלבד.</p>}
   {selected.session_date>israelDate()&&<p>ניתן לסמן נוכחות מיום המפגש.</p>}
   <Button variant="outline" disabled={disabled||selected.status==='cancelled'} onClick={()=>write('prepare_club_roster',{p_session_id:selected.id})}>פתיחה / עדכון רשימת משתתפים</Button>
   {!roster.length&&<p>אין משתתפים ברשימה. לחצו על עדכון הרשימה; אם היא עדיין ריקה, פנו למנהל.</p>}
   {roster.map(row=><InstructorAttendanceRow key={`${selected.id}-${row.membership_id}-${row.version}`} row={row} disabled={cannotMark} save={(status,notes)=>write('mark_club_attendance',{p_session_id:selected.id,p_membership_id:row.membership_id,p_status:status,p_expected_version:row.version,p_notes:notes})}/>)}
  </section>}
 </div>;
}
function InstructorAttendanceRow({row,disabled,save}){
 const [notes,setNotes]=useState(row.notes||'');
 return <article className="rounded-xl border p-3 space-y-3">
  <h3 className="font-bold">{row.participant_name}</h3><p className="text-sm">{labels[row.status]||'טרם סומן'}</p>
  <Input aria-label={`הערה עבור ${row.participant_name}`} placeholder="הערה / סיבת תיקון (רשות)" maxLength={1000} disabled={disabled} value={notes} onChange={e=>setNotes(e.target.value)}/>
  <div className="grid grid-cols-3 gap-2">{Object.entries(labels).map(([value,label])=><Button key={value} className="min-h-11 px-2" disabled={disabled} variant={row.status===value?'default':'outline'} aria-pressed={row.status===value} onClick={()=>save(value,notes)}>{label}</Button>)}</div>
 </article>;
}
