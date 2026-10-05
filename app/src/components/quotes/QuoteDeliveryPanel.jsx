import DeliveryButtons from '@/components/delivery/DeliveryButtons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { boundedQuotationOperation, canManageQuotations, validQuotationEmail, normalizeQuotationPhone } from '@/lib/quotations';
import { deliveryStateText as stateText } from '@/lib/deliveryStatus';
import {latestDeliveryAttempt,canManuallyResend,reconcileLocalAttempt} from '@/lib/manualDelivery';
import ResendConfirmation from '@/components/delivery/ResendConfirmation';

const CHANNELS = ['email','whatsapp'];
const storageKey = (quote,channel) => 'quotation-delivery:'+quote.id+':'+quote.quotation_revision_id+':'+channel;
function remembered(quote,channel) {
  try { return JSON.parse(sessionStorage.getItem(storageKey(quote,channel)) || 'null'); } catch { return null; }
}
function remember(quote,channel,value) {
  try { sessionStorage.setItem(storageKey(quote,channel),JSON.stringify(value)); } catch { /* Server revision/channel uniqueness remains authoritative. */ }
}
export default function QuoteDeliveryPanel({ quote, createPdf, onBusyChange }) {
  const { user } = useAuth();
  const allowed = canManageQuotations(user?.role);
  const [capabilities,setCapabilities] = useState({});
  const [history,setHistory] = useState([]);
  const [readError,setReadError] = useState('');
  const [loaded,setLoaded] = useState(false);
  const [busy,setBusy] = useState(null);
  const [message,setMessage] = useState('');
  const [resend,setResend] = useState(null);
  const [local,setLocal] = useState(() => Object.fromEntries(CHANNELS.map(channel => [channel,remembered(quote,channel)])));
  const inFlight = useRef(false);
  const read = useCallback(async () => {
    if (!allowed) return;
    setLoaded(false); setReadError('');
    try {
      const [email,whatsapp,attempts] = await boundedQuotationOperation(() => Promise.all([
        supabase.functions.invoke('send-quote-email',{body:{action:'capabilities'}}),
        supabase.functions.invoke('send-quote-whatsapp',{body:{action:'capabilities'}}),
        supabase.from('quotation_delivery_attempts').select('*').eq('quote_id',quote.id).order('created_at',{ascending:false}),
      ]));
      if (attempts.error) throw attempts.error;
      setCapabilities({email:email.error ? null : email.data,whatsapp:whatsapp.error ? null : whatsapp.data});
      setHistory(attempts.data || []); setLoaded(true);
      const resolved={};for(const channel of CHANNELS){const row=reconcileLocalAttempt(attempts.data||[],remembered(quote,channel),channel);if(row){remember(quote,channel,row);resolved[channel]=row;}}setLocal(old=>({...old,...resolved}));
    } catch { setReadError('לא ניתן לעדכן כרגע. נסו לרענן בעוד רגע.'); }
  }, [allowed,quote.id]);
  useEffect(() => { read(); }, [read]);
  const latest = channel => latestDeliveryAttempt(history,local[channel],channel);
  const existing = channel => latest(channel);
  const configured = channel => {
    const capability = capabilities[channel];
    const validDestination = channel === 'email' ? validQuotationEmail(quote.client_email) : normalizeQuotationPhone(quote.client_phone);
    return Boolean(quote.quotation_revision_id) && loaded && capability?.ok && capability.canSend === true && validDestination
      && (channel !== 'whatsapp' || (capability.template?.status === 'APPROVED' && capability.template?.compatible === true));
  };
  const available=channel=>configured(channel)&&!existing(channel);
  const manualAvailable=channel=>configured(channel)&&canManuallyResend(latest(channel));
  const send = async (channel,resendOf=null) => {
    if (inFlight.current || !allowed || (resendOf?(!manualAvailable(channel)||latest(channel)?.id!==resendOf):!available(channel))) return;
    setResend(null);
    inFlight.current = true; setBusy(channel); onBusyChange?.(true); setMessage('');
    let dispatchStarted = false;
    try {
      const pdf = await createPdf();
      const request = {requestId:crypto.randomUUID()};
      const pending = {...request,revision_id:quote.quotation_revision_id,state:'uncertain',resendOf};
      remember(quote,channel,pending); setLocal(old => ({...old,[channel]:pending}));
      dispatchStarted = true;
      const {data,error} = await boundedQuotationOperation(() => supabase.functions.invoke('send-quote-'+channel,{body:{action:resendOf?'manual_resend':'send',...(resendOf?{resendOf,confirmed:true}:{}),requestId:request.requestId,quoteId:quote.id,revisionId:quote.quotation_revision_id,pdfBase64:pdf.output('datauristring').split(',')[1]}}),45000);
      if (error || !data?.ok || !data?.attempt?.state){
       let code=data?.code;try{code ||= (await error?.context?.clone().json())?.code;}catch{/* Unknown errors remain blocked. */}
       if(['delivery_resend_stale','delivery_still_in_progress','delivery_resend_parent_invalid','quotation_revision_stale','quotation_delivery_already_claimed'].includes(code)){
        remember(quote,channel,null);setLocal(old=>({...old,[channel]:null}));setLoaded(false);setMessage('פרטי השליחה השתנו. רעננו מצב לפני שתמשיכו.');return;
       }
       throw new Error('delivery_result_unknown');
      }
      const result = {...data.attempt,requestId:request.requestId};
      remember(quote,channel,result); setLocal(old => ({...old,[channel]:result}));
      await read();
    } catch {
      setMessage(dispatchStarted ? 'השליחה מתעכבת. בדקו את מצב השליחה.' : 'לא ניתן להכין את המסמך. נסו שוב.');
    } finally { inFlight.current = false; setBusy(null); onBusyChange?.(false); }
  };
  if (!allowed) return null;
  return <section className="bg-white rounded-lg p-3 space-y-3 text-sm" aria-label="שליחת הצעת מחיר">
  {!quote.quotation_revision_id && <p>יש לשמור את ההצעה לפני שליחה.</p>}
  <DeliveryButtons latest={latest} available={available} manualAvailable={manualAvailable} busy={busy} onSend={send} onResend={channel=>setResend({channel,id:latest(channel).id,state:latest(channel).state,destination:channel==='email'?quote.client_email:quote.client_phone})}/>
  <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={read}>רענון מצב השליחה</Button>
    {CHANNELS.some(channel=>latest(channel)?.state==='dispatched'&&!canManuallyResend(latest(channel)))&&<p>השליחה בטיפול. נסו לרענן בעוד רגע.</p>}
    <ResendConfirmation selection={resend} busy={Boolean(busy)} onCancel={()=>setResend(null)} onConfirm={()=>resend&&send(resend.channel,resend.id)}/>
  {loaded && !capabilities.whatsapp?.canSend && <p>שליחת WhatsApp אינה זמינה כרגע.</p>}
    {!capabilities.email?.canSend && loaded && <p>שליחת מייל אינה זמינה כרגע.</p>}
    {busy && <p role="status">מכין ושולח את המסמך...</p>}
    {(message || readError) && <p role="alert">{message || readError}</p>}
    {history.length > 0 && <details><summary>היסטוריית שליחות ({history.length})</summary><ul>{history.map(row => <li key={row.id} className="py-1">{row.attempt_type==='manual_resend'?'שליחה חוזרת ידנית':'שליחה מקורית'} · {row.channel} · {row.destination} · {stateText(row.state)}</li>)}</ul></details>}
  </section>;
}
