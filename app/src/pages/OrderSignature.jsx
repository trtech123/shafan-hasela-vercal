import {useEffect,useRef,useState} from 'react';
import SignaturePad from '@/components/signatures/SignaturePad';
import {emptySignature,validSignature} from '@/lib/signature';
import {signatureRequest,validSignerName} from '@/lib/orderSignatureClient';
import {normalizeSignatureContact} from '@/lib/signatureContact';
import {Button} from '@/components/ui/button';

export default function OrderSignature() {
 const token=useRef(window.location.hash.slice(1));
 const requestId=useRef(null),locked=useRef(false),submission=useRef(null);
 const [revision,setRevision]=useState(null),[pdfUrl,setPdfUrl]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[signed,setSigned]=useState(false),[uncertain,setUncertain]=useState(false);
 const [name,setName]=useState(''),[phone,setPhone]=useState(''),[email,setEmail]=useState(''),[organization,setOrganization]=useState(''),[signerId,setSignerId]=useState(''),[signature,setSignature]=useState(emptySignature),[accepted,setAccepted]=useState(false);
 useEffect(()=>{
  // Fragments are not sent to HTTP servers; remove the capability from visible
  // history immediately. Keep it only in this page's memory, not localStorage.
  window.history.replaceState(null,'',window.location.pathname);
  const controller=new AbortController();
  (async()=>{try{
   if(!/^[A-Za-z0-9_-]{40,128}$/.test(token.current))throw new Error('link_unavailable');
   const response=await signatureRequest({action:'view',token:token.current},{signal:controller.signal});
   if(controller.signal.aborted)return;
   setRevision(response.revision);if(response.signed || response.revision?.status==='signed'){setSigned(true);return;}
  }catch{if(!controller.signal.aborted)setError('הקישור אינו זמין. יש לבקש מצוות שפן הסלע קישור חדש.');}finally{if(!controller.signal.aborted)setLoading(false);}})();
  return()=>{controller.abort();};
 },[]);
 useEffect(()=>()=>{if(pdfUrl)URL.revokeObjectURL(pdfUrl);},[pdfUrl]);
 const openPdf=async()=>{try{const pdf=await signatureRequest({action:'pdf',token:token.current});setPdfUrl(URL.createObjectURL(pdf));}catch{setError('לא ניתן לפתוח את קובץ האישור כרגע. אפשר לקרוא את פרטי ההזמנה בדף זה.');}};
 const submit=async event=>{
  event.preventDefault();if(locked.current||!revision)return;
  if(!submission.current){
   if(!name.trim()){setError('יש להזין שם מלא: שם פרטי ושם משפחה.');return;}
   if(!validSignerName(name)){setError('כתוב את השם כפי שמופיע בהזמנה');return;}
   if(!validSignature(signature)){setError('יש לצייר חתימה באצבע או בעכבר לפני האישור.');return;}
   if(!accepted){setError('יש לסמן שקראתם ואישרתם את ההזמנה והתנאים הכלליים.');return;}
   try{normalizeSignatureContact({phone,email,organization,signerId});}catch{setError('יש לבדוק את פרטי הקשר או תעודת הזהות שהוזנו.');return;}
  }
  locked.current=true;setBusy(true);setError('');
  if(!requestId.current)requestId.current=crypto.randomUUID();
  if(!submission.current)submission.current={action:'sign',token:token.current,requestId:requestId.current,fullName:name.trim(),...normalizeSignatureContact({phone,email,organization,signerId}),strokes:signature.strokes,accepted:true};
  try{const result=await signatureRequest(submission.current);if(!result.ok)throw new Error('request_failed');setSigned(true);setUncertain(false);}
  catch(error){if(error.message==='link_unavailable'){setError('הקישור אינו זמין. יש לפנות לצוות לקבלת אישור מעודכן.');setPdfUrl('');}else if(['invalid_signature','invalid_signer_id','invalid_contact_details'].includes(error.message)){submission.current=null;requestId.current=null;setUncertain(false);setError(error.message==='invalid_signature'?'יש לבדוק את השם המלא ולחתום מחדש בקווים ברורים.':'יש לבדוק את פרטי הקשר או תעודת הזהות שהוזנו.');}else{setUncertain(true);setError('לא התקבל אישור שמירה. אפשר לבדוק שוב באמצעות אותה בקשה, בלי ליצור חתימה נוספת.');}}
  finally{locked.current=false;setBusy(false);}
 };
 return <main dir="rtl" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900"><div className="mx-auto max-w-4xl space-y-5 rounded-xl bg-white p-5 shadow-sm">
  <h1 className="text-2xl font-bold">אישור הזמנה — שפן הסלע</h1>
  {loading&&<p role="status">טוען את גרסת האישור השמורה...</p>}
  {signed?<section role="status" className="rounded-lg bg-green-50 p-5"><h2 className="text-xl font-semibold">האישור נחתם בהצלחה</h2><p>החתימה נשמרה עם גרסת האישור שבדקתם. תודה!</p></section>:<>
   {revision&&<><p>גרסה {revision.revision_number} · הקישור בתוקף עד {new Date(revision.expires_at).toLocaleDateString('he-IL')}</p>
    <section aria-label="פרטי ההזמנה" className="rounded border bg-slate-50 p-4"><h2 className="font-semibold">פרטי ההזמנה לאישור</h2>
     {revision.summary?.orderNumber&&<p>מספר הזמנה: {revision.summary.orderNumber}</p>}
     {revision.summary?.clientName&&<p>שם הלקוח: {revision.summary.clientName}</p>}
     {revision.summary?.activityName&&<p>פעילות: {revision.summary.activityName}</p>}
     {revision.summary?.activityDate&&<p>תאריך: {revision.summary.activityDate}</p>}
     {revision.summary?.startTime&&<p>שעת התחלה: {revision.summary.startTime}</p>}
     {revision.summary?.endTime&&<p>שעת סיום: {revision.summary.endTime}</p>}
     {revision.summary?.site&&<p>אתר הפעילות: {revision.summary.site}</p>}
     {revision.summary?.clientPhone&&<p>טלפון הלקוח: {revision.summary.clientPhone}</p>}
     {revision.summary?.clientEmail&&<p>אימייל הלקוח: {revision.summary.clientEmail}</p>}
     {revision.summary?.organization&&<p>ארגון: {revision.summary.organization}</p>}
     {revision.summary?.participants!=null&&<p>{revision.summary.participants} משתתפים</p>}{revision.summary?.totalPrice!=null&&<p>סכום ההזמנה: ₪{revision.summary.totalPrice}</p>}
     {revision.summary?.terms?.length>0&&<><h3 className="mt-3 font-semibold">תנאי ההזמנה</h3><ol className="list-decimal pr-5">{revision.summary.terms.map((term,index)=><li key={index}>{term}</li>)}</ol></>}
     <p>המסמך המלא זמין גם כקובץ PDF לצפייה.</p>
    </section>
    <Button type="button" variant="outline" onClick={openPdf}>צפייה בקובץ האישור המלא (PDF)</Button>
    {pdfUrl&&<><a className="block font-semibold text-blue-700 underline" href={pdfUrl} target="_blank" rel="noopener noreferrer">פתיחת האישור המלא / הורדת PDF</a><object aria-label="גרסת אישור ההזמנה לחתימה" data={pdfUrl} type="application/pdf" className="h-[65vh] w-full rounded border"><p>אפשר להמשיך ולחתום גם אם המכשיר אינו מציג PDF.</p></object></>}
    <form noValidate onSubmit={submit} className="space-y-4">
     <label className="block">שם מלא<input autoComplete="name" maxLength={120} required disabled={busy||uncertain} value={name} onChange={event=>setName(event.target.value)} className="mt-1 block w-full rounded border p-3"/></label>
     {!revision.summary?.clientPhone&&<label className="block">טלפון להשלמה<input autoComplete="tel" inputMode="tel" maxLength={24} disabled={busy||uncertain} value={phone} onChange={event=>setPhone(event.target.value)} className="mt-1 block w-full rounded border p-3"/></label>}
     {!revision.summary?.clientEmail&&<label className="block">אימייל להשלמה<input autoComplete="email" type="email" maxLength={320} disabled={busy||uncertain} value={email} onChange={event=>setEmail(event.target.value)} className="mt-1 block w-full rounded border p-3"/></label>}
     {!revision.summary?.organization&&<label className="block">שם ארגון להשלמה<input maxLength={300} disabled={busy||uncertain} value={organization} onChange={event=>setOrganization(event.target.value)} className="mt-1 block w-full rounded border p-3"/></label>}
     <label className="block">תעודת זהות של החותם (רשות)<input inputMode="numeric" maxLength={12} disabled={busy||uncertain} value={signerId} onChange={event=>setSignerId(event.target.value)} className="mt-1 block w-full rounded border p-3"/></label>
     <SignaturePad value={signature} onChange={setSignature} disabled={busy||uncertain} helpText="חתמו באצבע או בעכבר. אפשר לנקות ולחתום מחדש לפני האישור."/>
     <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded border p-3"><input type="checkbox" aria-label="אישור ההזמנה והתנאים הכלליים" checked={accepted} disabled={busy||uncertain} onChange={event=>setAccepted(event.target.checked)} className="mt-1 h-6 w-6 shrink-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"/><span>{revision.snapshot?.acceptanceText}</span></label>
     <p className="text-sm text-slate-600">החתימה מאשרת את ההזמנה ואת התנאים הכלליים שהוצגו. היא אינה מחליפה חתימות נפרדות על הצהרות בטיחות או קטינים.</p>
     <Button type="submit" disabled={busy}>{busy?'שומר חתימה...':uncertain?'בדיקת ושמירת אותה חתימה':'אישור וחתימה'}</Button>
    </form></>}
  </>}
  {error&&<p role="alert" className="text-red-700">{error}</p>}
 </div></main>;
}
