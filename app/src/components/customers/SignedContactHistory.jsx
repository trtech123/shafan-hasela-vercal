import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/api/supabaseClient';
import {signatureRequest} from '@/lib/orderSignatureClient';
import {Button} from '@/components/ui/button';

export default function SignedContactHistory({customerId,orderId,leadId}) {
 const [rows,setRows]=useState([]),[error,setError]=useState(false),[loading,setLoading]=useState(false);
 const [preview,setPreview]=useState(null),[previewError,setPreviewError]=useState(false);
 const previewGeneration=useRef(0);
 const field=orderId?'order_id':leadId?'lead_id':'customer_id',id=orderId||leadId||customerId;
 useEffect(()=>{
  if(!id)return;
  let active=true;setLoading(true);setError(false);setRows([]);
  supabase.from('order_signature_responses').select('revision_id,order_id,lead_id,lead_link_status,full_name,details,signed_at')
   .eq(field,id).order('signed_at',{ascending:false}).limit(20)
   .then(({data,error:failure})=>{if(active){setRows(failure?[]:data||[]);setError(Boolean(failure));setLoading(false);}})
   .catch(()=>{if(active){setError(true);setLoading(false);}});
  return()=>{active=false;};
 },[field,id]);
 useEffect(()=>()=>{if(preview?.url)URL.revokeObjectURL(preview.url);},[preview]);
 useEffect(()=>()=>{previewGeneration.current++;},[]);
 if(!id)return null;
 const showSigned=async row=>{
  const generation=++previewGeneration.current;setPreview(null);setPreviewError(false);
  try{
   const pdf=await signatureRequest({action:'pdf',revisionId:row.revision_id,signed:true},{staff:true});
   if(generation===previewGeneration.current)setPreview({revisionId:row.revision_id,url:URL.createObjectURL(pdf)});
  }catch{if(generation===previewGeneration.current)setPreviewError(true);}
 };
 return <section className="rounded border p-3 text-sm" aria-label="פרטים שנמסרו בחתימה">
  <h3 className="font-semibold">פרטים שנמסרו בחתימת הזמנה</h3>
  <p className="text-muted-foreground">המידע נשמר בנפרד. פרטי הכרטיס הקיימים אינם משתנים אוטומטית.</p>
  {loading&&<p role="status">טוען פרטי חתימות...</p>}
  {error&&<p role="status">לא ניתן לטעון כעת את פרטי החתימות.</p>}
  {!loading&&!error&&rows.length===0&&<p>אין פרטי השלמה חתומים מקושרים.</p>}
  {rows.map(row=><div key={row.revision_id} className="border-t py-2">
   <p>{row.full_name} · {new Date(row.signed_at).toLocaleDateString('he-IL')}</p>
   {row.details?.phone&&<p dir="ltr">{row.details.phone}</p>}{row.details?.email&&<p dir="ltr">{row.details.email}</p>}
   {row.details?.organization&&<p>{row.details.organization}</p>}
   {row.details?.signerId&&<p>תעודת זהות של החותם: <bdi>{row.details.signerId}</bdi></p>}
   <p>הזמנה: <bdi>{row.order_id}</bdi></p>
   <p>{row.lead_link_status==='linked'?'ליד מקושר':row.lead_link_status==='ambiguous'?'קישור לליד דורש בדיקה':'לא נמצא ליד מקושר — נדרשת בדיקה'}</p>
   <Button type="button" variant="outline" onClick={()=>showSigned(row)}>צפייה בחתימה ובאישור החתום</Button>
  </div>)}
  {previewError&&<p role="alert">לא ניתן לפתוח כרגע את האישור החתום.</p>}
  {preview&&<div className="space-y-2"><Button type="button" variant="outline" onClick={()=>{previewGeneration.current++;setPreview(null);}}>סגירת האישור החתום</Button><iframe title="אישור הזמנה חתום" src={preview.url} className="h-[65vh] w-full rounded border"/></div>}
 </section>;
}
