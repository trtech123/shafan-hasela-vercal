import DeliveryButtons from '@/components/delivery/DeliveryButtons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {latestDeliveryAttempt,canManuallyResend,reconcileLocalAttempt} from '@/lib/manualDelivery';
import ResendConfirmation from '@/components/delivery/ResendConfirmation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/api/supabaseClient';
import { boundedQuotationOperation } from '@/lib/quotations';
import { orderDeliveryStateText, validOrderEmail as validEmail, normalizeOrderPhone as normalizeQuotationPhone } from '@/lib/orderConfirmation';
const channels=['email','whatsapp'];
const endpoint=channel=>channel==='email' ? 'send-order-doc' : 'send-order-whatsapp';
const key=(orderId,channel)=>`order-confirmation-delivery:${orderId}:${channel}`;
function recalled(orderId,channel) {try{return JSON.parse(sessionStorage.getItem(key(orderId,channel)) || 'null');}catch{return null;}}
function persist(orderId,channel,value) {try{sessionStorage.setItem(key(orderId,channel),JSON.stringify(value));}catch{/* Database uniqueness remains authoritative. */}}
const notDispatchedCodes=new Set(['invalid_request','invalid_pdf','pdf_too_large','invalid_saved_order','invalid_saved_email','invalid_saved_phone','order_version_stale','authentication_required','order_delivery_forbidden','server_not_configured','email_not_configured','whatsapp_not_configured','whatsapp_template_unavailable','whatsapp_template_lookup_unavailable']);
async function rejectionCode(data,error){if(data?.code)return data.code;try{return (await error?.context?.clone().json())?.code;}catch{return null;}}
['delivery_resend_stale','delivery_still_in_progress','delivery_resend_parent_invalid','order_delivery_already_claimed'].forEach(code=>notDispatchedCodes.add(code));
export default function OrderDeliveryPanel({orderId,document,createPdf,onBusyChange}) {
 const [capabilities,setCapabilities]=useState({}),[history,setHistory]=useState([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(null),[message,setMessage]=useState(''),[readError,setReadError]=useState('');
 const [recipient,setRecipient]=useState(document.data.client_email || '');
 const [resend,setResend]=useState(null);
 const [local,setLocal]=useState(()=>Object.fromEntries(channels.map(c=>[c,recalled(orderId,c)])));
 const inFlight=useRef(false);
 const read=useCallback(async()=>{
  setLoaded(false);setReadError('');
  try{
   const [email,whatsapp,attempts]=await boundedQuotationOperation(()=>Promise.all([
    supabase.functions.invoke('send-order-doc',{body:{action:'capabilities',orderId}}),
    supabase.functions.invoke('send-order-whatsapp',{body:{action:'capabilities',orderId}}),
    supabase.from('order_delivery_attempts').select('id,version,channel,destination,state,reason,created_at,dispatched_at,finished_at,resend_of,attempt_type').eq('order_id',orderId).order('created_at',{ascending:false}),
   ]),25000);
   if(attempts.error)throw Error('history_unavailable');
   setCapabilities({email:email.error?null:email.data,whatsapp:whatsapp.error?null:whatsapp.data});setHistory(attempts.data || []);setLoaded(true);
   const resolved={};for(const channel of channels){const previous=recalled(orderId,channel);const row=reconcileLocalAttempt(attempts.data||[],previous,channel);if(row){persist(orderId,channel,row);resolved[channel]=row;}}
   setLocal(old=>({...old,...resolved}));
  }catch{setReadError('לא ניתן לעדכן כרגע. נסו לרענן בעוד רגע.');}
 },[orderId]);
 useEffect(()=>{read();},[read]);
 const latest=channel=>latestDeliveryAttempt(history,local[channel],channel);
 const blocker=channel=>latest(channel);
 const configured=channel=>loaded && capabilities[channel]?.ok && capabilities[channel]?.canSend===true && (channel==='email'?validEmail(recipient.trim()):Boolean(normalizeQuotationPhone(document.data.client_phone))) && (channel!=='whatsapp'||capabilities[channel]?.template?.compatible===true);
 const eligible=channel=>configured(channel)&&!blocker(channel);
 const manualEligible=channel=>configured(channel)&&canManuallyResend(latest(channel));
 const send=async (channel,resendOf=null)=>{
  if(inFlight.current || (resendOf?(!manualEligible(channel)||latest(channel)?.id!==resendOf):!eligible(channel)))return;
  setResend(null);
  inFlight.current=true;setBusy(channel);onBusyChange?.(true);setMessage('');let dispatched=false;
  try{
   const pdf=await createPdf();const requestId=crypto.randomUUID();
   const pending={requestId,version:document.version,state:'uncertain',resendOf};persist(orderId,channel,pending);setLocal(old=>({...old,[channel]:pending}));dispatched=true;
   const {data,error}=await boundedQuotationOperation(signal=>supabase.functions.invoke(endpoint(channel),{signal,body:{action:resendOf?'manual_resend':'send',...(resendOf?{resendOf,confirmed:true}:{}),requestId,orderId,version:document.version,pdfBase64:pdf.output('datauristring').split(',')[1],...(channel==='email'?{recipient:recipient.trim()}:{})}}),60000);
   if(error || !data?.ok || !data.attempt?.state){
    const code=await rejectionCode(data,error);
    if(notDispatchedCodes.has(code)){
     persist(orderId,channel,null);setLocal(old=>({...old,[channel]:null}));setLoaded(false);
     setMessage(code==='order_version_stale'?'ההזמנה השתנתה לפני השליחה. לא נשלחה הודעה; יש לסגור ולפתוח את האישור המעודכן.':'לא ניתן לשלוח כרגע. בדקו את הפרטים ורעננו מצב.');return;
    }
    throw Error('delivery_uncertain');
   }
   persist(orderId,channel,data.attempt);setLocal(old=>({...old,[channel]:data.attempt}));await read();
  }catch{setMessage(dispatched?'השליחה מתעכבת. בדקו את מצב השליחה.':'לא ניתן להכין את המסמך. נסו שוב.');}
  finally{inFlight.current=false;setBusy(null);onBusyChange?.(false);}
 };
 return <section className="border rounded-xl p-4 space-y-3 text-sm" aria-label="שליחת אישור הזמנה">
  <label className="block" htmlFor="order-confirmation-email">כתובת אימייל לשליחה</label><Input id="order-confirmation-email" type="email" dir="ltr" value={recipient} disabled={Boolean(busy)||Boolean(blocker('email'))} onChange={e=>setRecipient(e.target.value)} aria-invalid={!validEmail(recipient.trim())}/>
  {!validEmail(recipient.trim()) && <p>יש להזין כתובת אימייל תקינה לפני שליחה.</p>}
  <p>טלפון WhatsApp שמור: <bdi>{document.data.client_phone || 'לא תועד'}</bdi></p>
  {!normalizeQuotationPhone(document.data.client_phone) && <p>מספר הטלפון השמור אינו תקין לשליחה. יש לתקן את פרטי ההזמנה לפני שליחה.</p>}
  <DeliveryButtons latest={latest} available={eligible} manualAvailable={manualEligible} busy={busy} onSend={send} onResend={channel=>setResend({channel,id:latest(channel).id,state:latest(channel).state,destination:channel==='email'?recipient.trim():document.data.client_phone})}/>
  <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={read}>רענון מצב השליחה</Button>
  {channels.some(channel=>latest(channel)?.state==='dispatched'&&!canManuallyResend(latest(channel)))&&<p>השליחה בטיפול. נסו לרענן בעוד רגע.</p>}
  <ResendConfirmation selection={resend} busy={Boolean(busy)} onCancel={()=>setResend(null)} onConfirm={()=>resend&&send(resend.channel,resend.id)}/>
  {busy && <p role="status">מכין ושולח את המסמך...</p>}
  {loaded && !capabilities.whatsapp?.canSend && <p>שליחת WhatsApp אינה זמינה כרגע.</p>}
  {loaded && !capabilities.email?.canSend && <p>שירות הדוא״ל אינו זמין כרגע.</p>}
  {loaded && channels.some(channel=>capabilities[channel]?.reason==='invalid_saved_order') && <p>חסרים שם לקוח, מספר הזמנה או תאריך תקין בנתונים השמורים. יש להשלים את ההזמנה לפני שליחה.</p>}
  {(readError||message) && <p role="alert">{readError||message}</p>}
  {history.length>0 && <details><summary>היסטוריית שליחות ({history.length})</summary><ul>{history.map(row=><li key={row.id} className="border-t py-2">{row.attempt_type==='manual_resend'?'שליחה חוזרת ידנית':'שליחה מקורית'} · {new Date(row.created_at).toLocaleString('he-IL')} · {row.channel==='email'?'מייל':'WhatsApp'} · <bdi>{row.destination}</bdi> · {orderDeliveryStateText(row.state)}</li>)}</ul></details>}
 </section>;
}
