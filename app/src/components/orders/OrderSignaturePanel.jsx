import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {supabase} from '@/api/supabaseClient';
import {signatureRequest,signatureStateText,downloadConfirmation} from '@/lib/orderSignatureClient';
import {validOrderEmail,orderDeliveryStateText} from '@/lib/orderConfirmation';
import {canManuallyResend} from '@/lib/manualDelivery';

export default function OrderSignaturePanel({orderId,email='',onBusyChange}) {
 const [revisions,setRevisions]=useState([]),[deliveries,setDeliveries]=useState([]),[legacy,setLegacy]=useState([]),[recipient,setRecipient]=useState(email),[link,setLink]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[message,setMessage]=useState(''),[confirmation,setConfirmation]=useState(null);
 const [preview,setPreview]=useState(null);
 const previewGeneration=useRef(0),previewRef=useRef(null);
 useEffect(()=>{if(preview)previewRef.current?.scrollIntoView?.({block:'start',behavior:'smooth'});},[preview]);
 useEffect(()=>{previewGeneration.current++;setPreview(null);return()=>{previewGeneration.current++;};},[orderId]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
 const closePreview=()=>{previewGeneration.current++;setPreview(null);};
 const locked=useRef(false);
 const refresh=useCallback(async()=>{
  const history=await signatureRequest({action:'history',orderId},{staff:true});
  setRevisions(history.revisions || []);setDeliveries(history.deliveries || []);setLoaded(true);
  const old=await supabase.from('order_delivery_attempts').select('id,channel,destination,state,created_at,attempt_type').eq('order_id',orderId).order('created_at',{ascending:false});
  if(!old.error)setLegacy(old.data || []);
 },[orderId]);
 useEffect(()=>{refresh().catch(()=>setMessage('לא ניתן לטעון את היסטוריית האישורים כרגע.'));},[refresh]);
 const perform=async operation=>{
  if(locked.current)return;locked.current=true;setBusy(true);onBusyChange?.(true);setMessage('');
  try{await operation();}catch{setMessage('הפעולה לא הושלמה או שמצבה עדיין אינו ידוע. רעננו מצב לפני ניסיון נוסף.');}finally{locked.current=false;setBusy(false);onBusyChange?.(false);}
 };
 const create=()=>perform(async()=>{setLink('');const result=await signatureRequest({action:'create',orderId},{staff:true});setLink(result.signingUrl);await refresh();});
 const download=(revision,signed)=>perform(async()=>{const pdf=signed&&preview?.revision.id===revision.id?preview.pdf:await signatureRequest({action:'pdf',revisionId:revision.id,signed},{staff:true});downloadConfirmation(pdf,`order-confirmation-v${revision.revision_number}${signed?'-signed':''}.pdf`);});
 const showSigned=revision=>perform(async()=>{
  closePreview();const generation=previewGeneration.current;
  try{
   const pdf=await signatureRequest({action:'pdf',revisionId:revision.id,signed:true},{staff:true});
   const {PDFDocument,PDFName,PDFArray,PDFRef}=await import('pdf-lib');
   const document=await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()));
   const pages=document.getPages(),destination=document.catalog.lookup(PDFName.of('OpenAction'));
   const target=destination instanceof PDFArray?destination.get(0):null;
   // Only a direct destination to a page in this PDF is used; actions are never followed.
   const targetIndex=target instanceof PDFRef?pages.findIndex(item=>item.ref.toString()===target.toString()):-1;
   const page=targetIndex>=0?targetIndex+1:pages.length;
   if(page<1)throw Error('empty_pdf');
   if(generation!==previewGeneration.current)return;
   setPreview({revision,pdf,page,url:URL.createObjectURL(pdf)});
  }catch{if(generation===previewGeneration.current)setMessage('לא ניתן לפתוח את האישור החתום כרגע. נסו שוב.');}
 });
 const send=(revision,channel,resendOf)=>perform(async()=>{
  setConfirmation(null);
  const result=await signatureRequest({action:'deliver',revisionId:revision.id,channel,requestId:crypto.randomUUID(),...(channel==='email'?{recipient:recipient.trim()}:{}),...(resendOf?{resendOf,confirmed:true}:{})},{staff:true});
  await refresh();setMessage(`מצב השליחה: ${orderDeliveryStateText(result.attempt?.state || 'uncertain')}`);
 });
 const revoke=revision=>perform(async()=>{setConfirmation(null);await signatureRequest({action:'revoke',revisionId:revision.id},{staff:true});setLink('');await refresh();});
 const awaiting=revision=>['awaiting_signature','awaiting','pending'].includes(revision.status);
 const latest=(revision,channel)=>deliveries.find(row=>row.revision_id===revision.id&&row.channel===channel);
 return <section className="space-y-4 rounded-xl border p-4" aria-label="חתימות וגרסאות אישור הזמנה">
  <h2 className="font-semibold text-lg">אישור הזמנה וחתימת לקוח</h2><p className="text-sm">הכנת אישור שומרת גרסה קבועה של פרטי ההזמנה והתנאים. הלקוח יחתום רק על גרסה זו.</p>
  <div className="flex flex-wrap gap-2"><Button disabled={busy||!loaded} onClick={create}>הכנת אישור לחתימה</Button><Button variant="outline" disabled={busy} onClick={()=>perform(refresh)}>רענון חתימות ושליחות</Button></div>
  {link&&<div className="space-y-2 rounded bg-blue-50 p-3"><p>קישור החתימה מוכן. אפשר לשלוח את האישור במייל או בוואטסאפ.</p><Button variant="outline" disabled={busy} onClick={()=>perform(async()=>{await navigator.clipboard.writeText(link);setMessage('קישור החתימה הועתק.');})}>העתקת קישור חתימה</Button></div>}
  <label className="block text-sm">כתובת אימייל לשליחת האישור<input type="email" value={recipient} disabled={busy} onChange={event=>setRecipient(event.target.value)} dir="ltr" className="mt-1 block w-full rounded border p-2"/></label>
  {revisions.length===0&&loaded&&<p>טרם הוכנה גרסת אישור לחתימה.</p>}
  <ul className="space-y-3">{revisions.map(revision=><li key={revision.id} className="space-y-2 rounded border p-3">
   <p className="font-semibold">גרסה {revision.revision_number} · {signatureStateText[revision.status] || 'מצב לא זמין'}</p>
   {revision.current_differs&&<p className="font-semibold text-amber-800" role="status">ההזמנה הנוכחית שונה מהגרסה השמורה{revision.signed_at?' והחתומה':''}. יש להכין אישור חדש ולקבל חתימה חדשה.</p>}
   {revision.signed_at&&<p>חתם/ה: {revision.full_name} · {new Date(revision.signed_at).toLocaleString('he-IL')} · גרסה {revision.revision_number}</p>}
   {revision.signed_at&&revision.signer_id&&<p>תעודת זהות: <bdi>{revision.signer_id}</bdi></p>}
   {revision.signed_at&&<p className="text-sm">פרטי החתימה מופיעים בעמודים האחרונים של האישור החתום.</p>}
   {awaiting(revision)&&<p className="text-sm">תוקף קישור החתימה: {new Date(revision.expires_at).toLocaleString('he-IL')}</p>}
   <div className="flex flex-wrap gap-2">{revision.signed_at&&<Button disabled={busy} onClick={()=>showSigned(revision)}>צפייה באישור החתום — גרסה {revision.revision_number}</Button>}<Button variant="outline" disabled={busy} onClick={()=>download(revision,false)}>הורדת האישור המקורי (ללא חתימה) — גרסה {revision.revision_number}</Button>
    {revision.signed_at&&<Button disabled={busy} onClick={()=>download(revision,true)}>הורדת האישור החתום — גרסה {revision.revision_number}</Button>}
    {(awaiting(revision)||['preparing','signing'].includes(revision.status))&&<Button variant="outline" disabled={busy} onClick={()=>setConfirmation({action:'revoke',revision})}>ביטול קישור החתימה</Button>}
   </div>
   {awaiting(revision)&&!revision.current_differs&&<div className="flex flex-wrap gap-2">{['email','whatsapp'].map(channel=>{const previous=latest(revision,channel);const label=channel==='email'?'מייל':'וואטסאפ';return <Button key={channel} disabled={busy||(channel==='email'&&!validOrderEmail(recipient.trim()))||(previous&&!canManuallyResend(previous))} onClick={()=>previous?setConfirmation({action:'send',revision,channel,resendOf:previous.id}):send(revision,channel)}>{previous?`שליחה חוזרת ב${label}`:`שליחת האישור ב${label}`}</Button>;})}</div>}
   {deliveries.filter(row=>row.revision_id===revision.id).map(row=><p key={row.id} className="text-sm">{new Date(row.created_at).toLocaleString('he-IL')} · {row.channel==='email'?'מייל':'WhatsApp'} · <bdi>{row.destination}</bdi> · {orderDeliveryStateText(row.state)}</p>)}
  </li>)}</ul>
  {preview&&<section ref={previewRef} className="space-y-3 rounded border p-3" aria-label="תצוגת אישור חתום">
   <h3 className="font-semibold">האישור החתום — גרסה {preview.revision.revision_number}</h3>
   <p>התצוגה נפתחת בעמוד החתימה של המסמך החתום. ההורדה שומרת את אותו המסמך במלואו.</p>
   <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>download(preview.revision,true)}>הורדת המסמך המוצג (חתום) — גרסה {preview.revision.revision_number}</Button><Button variant="outline" onClick={closePreview}>סגירת התצוגה החתומה</Button></div>
   <iframe title={'האישור החתום — גרסה '+preview.revision.revision_number} src={preview.url+'#page='+preview.page+'&zoom=page-width'} className="h-[70vh] w-full rounded border"/>
  </section>}
  {confirmation&&<div role="alertdialog" aria-label="אישור פעולה" className="space-y-2 rounded border border-amber-300 bg-amber-50 p-4"><p>{confirmation.action==='revoke'?'הקישור לא יאפשר עוד חתימה. הגרסה השמורה לא תימחק. לבטל את הקישור?':'ייתכן שההודעה הקודמת כבר הגיעה ללקוח. לשלוח שוב את אותה גרסה?'}</p><Button disabled={busy} onClick={()=>confirmation.action==='revoke'?revoke(confirmation.revision):send(confirmation.revision,confirmation.channel,confirmation.resendOf)}>אישור</Button><Button variant="outline" disabled={busy} onClick={()=>setConfirmation(null)}>חזרה</Button></div>}
  {legacy.length>0&&<details><summary>היסטוריית שליחות קודמות ({legacy.length})</summary><ul>{legacy.map(row=><li key={row.id} className="border-t py-2 text-sm">{new Date(row.created_at).toLocaleString('he-IL')} · {row.channel==='email'?'מייל':'WhatsApp'} · <bdi>{row.destination}</bdi> · {orderDeliveryStateText(row.state)}</li>)}</ul></details>}
  {busy&&<p role="status">הפעולה מתבצעת...</p>}{message&&<p role="status">{message}</p>}
 </section>;
}
