import { Button } from '@/components/ui/button';

// Presentation only: eligibility and dispatch remain owned by the delivery panel.
export default function DeliveryButtons({latest,available,manualAvailable,busy,onSend,onResend}) {
 return <div className="flex flex-wrap gap-4">{['email','whatsapp'].map(channel=>{
  const attempt=latest(channel);
  const status=attempt?.state==='accepted'?'נשלח ✓':attempt?.state==='failed'?'השליחה נכשלה. ניתן לנסות שוב.':attempt?'בדקו את מצב השליחה.':'';
  return <div key={channel} className="space-y-1">
   <Button variant={channel==='email'?'default':'outline'} disabled={Boolean(busy)||!(attempt?manualAvailable(channel):available(channel))} onClick={()=>attempt?onResend(channel):onSend(channel)}>{channel==='email'?'שלח במייל':'שלח ב-WhatsApp'}</Button>
   {status&&<p role="status" className={attempt.state==='accepted'?'text-emerald-700 text-sm':'text-slate-600 text-sm'}>{status}</p>}
  </div>;
 })}</div>;
}
