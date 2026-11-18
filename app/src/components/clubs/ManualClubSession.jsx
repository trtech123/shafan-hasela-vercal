import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {israelDate,shiftDate,validAttendanceRange} from '@/lib/clubAttendance';

export default function ManualClubSession({clubs,instructors,selectedClubId,busy,onCreate,onClose}) {
 const [club,setClub]=useState(selectedClubId);
 const [date,setDate]=useState(israelDate);
 const [start,setStart]=useState('');const [end,setEnd]=useState('');
 const [instructor,setInstructor]=useState(clubs.find(c=>c.id===selectedClubId)?.instructor_id||'');
 const [notes,setNotes]=useState('');
 const today=israelDate();const min=shiftDate(today,-366),max=shiftDate(today,90);
 const valid=clubs.some(c=>c.id===club&&c.status==='active')&&validAttendanceRange(date,date)&&date>=min&&date<=max&&/^\d{2}:\d{2}$/.test(start)&&/^\d{2}:\d{2}$/.test(end)&&end>start;
 const selectClass='h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
 return <form aria-label="מפגש חדש" className="rounded-xl border bg-card p-4 space-y-4" onSubmit={e=>{e.preventDefault();if(valid&&!busy)void onCreate({p_club_id:club,p_date:date,p_start:start,p_end:end,p_instructor_id:instructor||null,p_notes:notes});}}>
  <h2 className="text-lg font-bold">מפגש חדש</h2>
  <p className="text-sm text-muted-foreground">מפגש חד־פעמי לפי שעון ישראל. בדקו את הפרטים ואשרו יצירה; המערכת השבועית לא תשתנה.</p>
  <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
   <label>חוג<select aria-label="חוג למפגש החדש" className={selectClass} value={club} onChange={e=>{setClub(e.target.value);setInstructor(clubs.find(c=>c.id===e.target.value)?.instructor_id||'');}}>{clubs.filter(c=>c.status==='active').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label>תאריך<Input aria-label="תאריך המפגש" type="date" required min={min} max={max} value={date} onChange={e=>setDate(e.target.value)}/></label>
   <label>שעת התחלה<Input aria-label="שעת התחלה" type="time" required value={start} onChange={e=>setStart(e.target.value)}/></label>
   <label>שעת סיום<Input aria-label="שעת סיום" type="time" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
   <label>מדריך<select aria-label="מדריך למפגש החדש" className={selectClass} value={instructor} onChange={e=>setInstructor(e.target.value)}><option value="">ללא שיבוץ</option>{instructors.map(i=><option key={i.id} value={i.id}>{i.full_name}</option>)}</select></label>
   <label>הערה (רשות)<Input aria-label="הערה למפגש החדש" maxLength={1000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
  </fieldset>
  {start&&end&&end<=start&&<p className="text-sm text-red-700">שעת הסיום חייבת להיות אחרי שעת ההתחלה.</p>}
  <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy||!valid}>{busy?'יוצר מפגש…':'יצירת מפגש'}</Button><Button type="button" variant="outline" disabled={busy} onClick={onClose}>סגירת טופס מפגש</Button></div>
 </form>;
}
