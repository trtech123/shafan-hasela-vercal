import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { boundedQuotationOperation } from '@/lib/quotations';
import { canSendOrderConfirmation } from '@/lib/orderConfirmation';
import { buildQuotePdf } from '../quotes/quotePdf';
import OrderConfirmationDocument from './OrderConfirmationDocument';
import OrderDeliveryPanel from './OrderDeliveryPanel';
export default function OrderConfirmationPDF({order,onClose}) {
 const {user}=useAuth();const [document,setDocument]=useState(null),[loadError,setLoadError]=useState(''),[error,setError]=useState(''),[downloading,setDownloading]=useState(false),[sending,setSending]=useState(false);
 const docRef=useRef(null),inFlight=useRef(false);
 useEffect(()=>{let active=true;setDocument(null);setLoadError('');
  boundedQuotationOperation(()=>supabase.rpc('order_confirmation_document',{p_order_id:order.id}),15000).then(({data,error})=>{if(!active)return;if(error||!data?.version||!data?.data)throw Error('document_unavailable');setDocument(data);}).catch(()=>{if(active)setLoadError('לא ניתן לקרוא את ההזמנה השמורה. סגרו ופתחו שוב לאחר בדיקת ההרשאות והחיבור.');});
  return()=>{active=false;};
 },[order.id]);
 const createPdf=()=>boundedQuotationOperation(signal=>buildQuotePdf(docRef.current,{signal}),45000);
 const download=async()=>{if(inFlight.current||!document)return;inFlight.current=true;setDownloading(true);setError('');try{const pdf=await createPdf();pdf.save('אישור_הזמנה_'+document.data.order_number+'.pdf');}catch{setError('יצירת ה-PDF לא הושלמה. לא נשלחה הודעה.');}finally{inFlight.current=false;setDownloading(false);}};
 return <Dialog open onOpenChange={()=>{if(!downloading&&!sending)onClose();}}><DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto" dir="rtl" aria-describedby={undefined}>
  <DialogHeader><DialogTitle>אישור הזמנה ללקוח</DialogTitle></DialogHeader>
  <div className="flex gap-2"><Button disabled={!document||downloading||sending} onClick={download}>{downloading?'מכין PDF...':'הורד PDF'}</Button><Button variant="outline" disabled={downloading||sending} onClick={onClose}>סגירה</Button></div>
  {!document&&!loadError&&<p role="status">טוען את פרטי ההזמנה השמורים...</p>}
  {(loadError||error)&&<p role="alert">{loadError||error}</p>}
  {document && <>
   {document.can_send&&canSendOrderConfirmation(user?.role)?<OrderDeliveryPanel key={order.id+document.version} orderId={order.id} document={document} createPdf={createPdf} onBusyChange={setSending}/>:<p>האישור זמין לצפייה ולהורדה בלבד בהתאם להרשאות שלך.</p>}
   <div className="overflow-x-auto rounded-lg border bg-slate-100"><div ref={docRef}><OrderConfirmationDocument data={document.data}/></div></div>
  </>}
 </DialogContent></Dialog>;
}
