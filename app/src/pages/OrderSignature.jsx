import {useEffect,useRef,useState} from 'react';
import SignaturePad from '@/components/signatures/SignaturePad';
import {emptySignature,validSignature} from '@/lib/signature';
import {signatureRequest,validSignerName} from '@/lib/orderSignatureClient';
import {Button} from '@/components/ui/button';

export default function OrderSignature() {
 const token=useRef(window.location.hash.slice(1));
 const requestId=useRef(null),locked=useRef(false),submission=useRef(null);
 const [revision,setRevision]=useState(null),[pdfUrl,setPdfUrl]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[signed,setSigned]=useState(false),[uncertain,setUncertain]=useState(false);
 const [name,setName]=useState(''),[signature,setSignature]=useState(emptySignature),[accepted,setAccepted]=useState(false);
 useEffect(()=>{
  // Fragments are not sent to HTTP servers; remove the capability from visible
  // history immediately. Keep it only in this page's memory, not localStorage.
  window.history.replaceState(null,'',window.location.pathname);
  const controller=new AbortController();let objectUrl='';
  (async()=>{try{
   if(!/^[A-Za-z0-9_-]{40,128}$/.test(token.current))throw new Error('link_unavailable');
   const response=await signatureRequest({action:'view',token:token.current},{signal:controller.signal});
   if(controller.signal.aborted)return;
   setRevision(response.revision);if(response.signed || response.revision?.status==='signed'){setSigned(true);return;}
   const pdf=await signatureRequest({action:'pdf',token:token.current},{signal:controller.signal});
   if(controller.signal.aborted)return;objectUrl=URL.createObjectURL(pdf);setPdfUrl(objectUrl);
  }catch{if(!controller.signal.aborted)setError('הקישור אינו זמין. יש לבקש מצוות שפן הסלע קישור חדש.');}finally{if(!controller.signal.aborted)setLoading(false);}})();
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[]);
 const submit=async event=>{
  event.preventDefault();if(locked.current||!revision||!pdfUrl)return;
  if(!submission.current && (!validSignerName(name)||!validSignature(signature)||!accepted)){setError('יש להזין שם מלא, לצייר חתימה ולאשר את תנאי ההזמנה.');return;}
  locked.current=true;setBusy(true);setError('');
  if(!requestId.current)requestId.current=crypto.randomUUID();
  if(!submission.current)submission.current={action:'sign',token:token.current,requestId:requestId.current,fullName:name.trim(),strokes:signature.strokes,accepted:true};
  try{const result=await signatureRequest(submission.current);if(!result.ok)throw new Error('request_failed');setSigned(true);setUncertain(false);}
  catch(error){if(error.message==='link_unavailable'){setError('הקישור אינו זמין. יש לפנות לצוות לקבלת אישור מעודכן.');setPdfUrl('');}else if(error.message==='invalid_signature'){submission.current=null;requestId.current=null;setUncertain(false);setError('יש לבדוק את השם המלא ולחתום מחדש בקווים ברורים.');}else{setUncertain(true);setError('לא התקבל אישור שמירה. אפשר לבדוק שוב באמצעות אותה בקשה, בלי ליצור חתימה נוספת.');}}
  finally{locked.current=false;setBusy(false);}
 };
 return <main dir="rtl" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900"><div className="mx-auto max-w-4xl space-y-5 rounded-xl bg-white p-5 shadow-sm">
  <h1 className="text-2xl font-bold">אישור הזמנה — שפן הסלע</h1>
  {loading&&<p role="status">טוען את גרסת האישור השמורה...</p>}
  {signed?<section role="status" className="rounded-lg bg-green-50 p-5"><h2 className="text-xl font-semibold">האישור נחתם בהצלחה</h2><p>החתימה נשמרה עם גרסת האישור שבדקתם. תודה!</p></section>:<>
   {revision&&pdfUrl&&<><p>גרסה {revision.revision_number} · הקישור בתוקף עד {new Date(revision.expires_at).toLocaleDateString('he-IL')}</p><p>יש לעיין במסמך המלא לפני החתימה.</p>
    <a className="block font-semibold text-blue-700 underline" href={pdfUrl} target="_blank" rel="noopener noreferrer">פתיחת האישור המלא / הורדת PDF</a>
    <object aria-label="גרסת אישור ההזמנה לחתימה" data={pdfUrl} type="application/pdf" className="h-[65vh] w-full rounded border"><p>אם המסמך אינו מוצג במכשיר, פתחו אותו באמצעות הקישור מעל.</p></object>
    <form onSubmit={submit} className="space-y-4">
     <label className="block">שם מלא<input autoComplete="name" maxLength={120} required disabled={busy||uncertain} value={name} onChange={event=>setName(event.target.value)} className="mt-1 block w-full rounded border p-3"/></label>
     <SignaturePad value={signature} onChange={setSignature} disabled={busy||uncertain} helpText="חתמו באצבע או בעכבר. אפשר לנקות ולחתום מחדש לפני האישור."/>
     <label className="flex items-start gap-3"><input type="checkbox" checked={accepted} disabled={busy||uncertain} onChange={event=>setAccepted(event.target.checked)} className="mt-1 h-5 w-5"/><span>{revision.snapshot?.acceptanceText}</span></label>
     <p className="text-sm text-slate-600">החתימה מאשרת את ההזמנה ואת התנאים הכלליים שהוצגו. היא אינה מחליפה חתימות נפרדות על הצהרות בטיחות או קטינים.</p>
     <Button type="submit" disabled={busy||(!uncertain&&(!accepted||!validSignature(signature)||!validSignerName(name)))}>{busy?'שומר חתימה...':uncertain?'בדיקת ושמירת אותה חתימה':'אישור וחתימה'}</Button>
    </form></>}
  </>}
  {error&&<p role="alert" className="text-red-700">{error}</p>}
 </div></main>;
}
