import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/api/supabaseClient';
import {useAuth} from '@/lib/AuthContext';
import {Button} from '@/components/ui/button';

export default function InstructorUserLinks({users}){
 const {user}=useAuth();
 return user?.role==='admin'?<LinkManager users={users}/>:null;
}
function LinkManager({users}){
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const writing=useRef(false),mounted=useRef(true);
 async function load(){
  setLoading(true);
  try{const result=await supabase.rpc('get_instructor_user_links');if(result.error)throw result.error;if(mounted.current)setRows(result.data||[]);}
  catch{if(mounted.current){setRows([]);setError('לא ניתן לטעון את קישורי המדריכים.');}}
  finally{if(mounted.current)setLoading(false);}
 }
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[]);
 async function save(row,profile){
  if(writing.current)return;writing.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await supabase.rpc('set_instructor_user_link',{p_instructor_id:row.instructor_id,p_profile_id:profile||null,p_expected_version:row.version});
   if(result.error)throw result.error;
   if(mounted.current)setNotice('קישור המדריך נשמר.');
  }catch(e){if(mounted.current)setError(String(e?.message).includes('already_linked')?'המשתמש כבר מקושר למדריך אחר. יש לנתק את הקישור הקודם במפורש.':String(e?.message).includes('link_conflict')?'הקישור השתנה במקביל. הנתונים נטענו מחדש.':'שמירת הקישור לא אושרה. בדקו את תפקיד המשתמש ורעננו לפני ניסיון נוסף.');}
  finally{if(mounted.current)await load();writing.current=false;if(mounted.current)setBusy(false);}
 }
 return <section className="rounded-2xl border bg-card p-5 space-y-3 text-card-foreground" aria-label="קישור מדריכים למשתמשים">
  <h2 className="text-lg font-semibold">קישור מדריכים למשתמשים</h2>
  <p className="text-sm text-muted-foreground">בחרו משתמש בתפקיד מדריך ואשרו את זהותו. אין קישור אוטומטי לפי שם, אימייל או טלפון. קישור זה מאפשר גישה למפגשי החוגים המשויכים לרשומת המדריך.</p>
  <p className="text-sm text-muted-foreground">לפני מחיקת משתמש מקושר, שמרו עבורו ״ללא קישור״. שינוי קישור אינו משנה את שיבוץ המפגשים.</p>
  {error&&<p role="alert" className="text-red-700">{error}</p>}{notice&&<p role="status" className="text-emerald-800">{notice}</p>}
  {loading&&<p>טוען קישורים…</p>}
  {!loading&&!rows.length&&!error&&<p>אין רשומות מדריכים. יש ליצור רשומת מדריך במסך המדריכים.</p>}
  <Button variant="outline" disabled={busy||loading} onClick={()=>{setError('');void load();}}>רענון קישורים</Button>
  <div className="grid gap-3 lg:grid-cols-2">{rows.map(row=><LinkRow key={`${row.instructor_id}-${row.version}`} row={row} users={users} disabled={busy||loading} save={profile=>save(row,profile)}/>)}</div>
 </section>;
}
function LinkRow({row,users,disabled,save}){
 const [profile,setProfile]=useState(row.profile_id||'');
 const assigned=users.find(u=>u.id===row.profile_id);
 return <div className="rounded-xl border p-3 space-y-2">
  <h3 className="font-bold">{row.full_name}</h3>
  <p className="text-xs text-muted-foreground" dir="ltr">{row.instructor_id}</p>
  {assigned&&assigned.role!=='instructor'&&<p className="text-amber-800">למשתמש המקושר אין כרגע תפקיד מדריך; אין לו גישת מדריך לנוכחות.</p>}
  <select aria-label={`משתמש עבור ${row.full_name}`} className="w-full min-w-0 rounded-md border bg-background p-2 text-sm" disabled={disabled} value={profile} onChange={e=>setProfile(e.target.value)}>
   <option value="">ללא קישור</option>
   {assigned&&assigned.role!=='instructor'&&<option value={assigned.id} disabled>{assigned.full_name} (תפקיד אחר)</option>}
   {users.filter(u=>u.role==='instructor').map(u=><option key={u.id} value={u.id}>{u.full_name} · {u.email} · {u.id}</option>)}
  </select>
  <Button variant="outline" disabled={disabled||profile===(row.profile_id||'')} onClick={()=>save(profile)}>שמירת קישור</Button>
  {row.updated_at&&<p className="text-xs text-muted-foreground">עודכן: {new Date(row.updated_at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})} · {users.find(u=>u.id===row.updated_by)?.full_name||'מנהל'} · גרסה {row.version}</p>}
 </div>;
}
