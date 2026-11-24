import {useEffect,useState} from 'react';
import {supabase} from '@/api/supabaseClient';

export default function SignedContactHistory({customerId}) {
 const [rows,setRows]=useState([]),[error,setError]=useState(false);
 useEffect(()=>{
  if(!customerId)return;
  let active=true;
  supabase.from('order_signature_responses').select('revision_id,order_id,lead_id,lead_link_status,full_name,details,signed_at')
   .eq('customer_id',customerId).order('signed_at',{ascending:false}).limit(10)
   .then(({data,error:failure})=>{if(active){setRows(failure?[]:data||[]);setError(Boolean(failure));}})
   .catch(()=>{if(active)setError(true);});
  return()=>{active=false;};
 },[customerId]);
 if(!customerId)return null;
 return <section className="rounded border p-3 text-sm" aria-label="פרטים שנמסרו בחתימה">
  <h3 className="font-semibold">פרטים שנמסרו בחתימת הזמנה</h3>
  <p className="text-muted-foreground">המידע נשמר בנפרד. פרטי הכרטיס הקיימים אינם משתנים אוטומטית.</p>
  {error&&<p role="status">לא ניתן לטעון כעת את פרטי החתימות.</p>}
  {rows.map(row=><div key={row.revision_id} className="border-t py-2">
   <p>{row.full_name} · {new Date(row.signed_at).toLocaleDateString('he-IL')}</p>
   {row.details?.phone&&<p dir="ltr">{row.details.phone}</p>}{row.details?.email&&<p dir="ltr">{row.details.email}</p>}
   {row.details?.organization&&<p>{row.details.organization}</p>}
   <p>{row.lead_link_status==='linked'?'ליד מקושר':row.lead_link_status==='ambiguous'?'קישור לליד דורש בדיקה':'לא נמצא ליד מקושר'}</p>
  </div>)}
 </section>;
}
