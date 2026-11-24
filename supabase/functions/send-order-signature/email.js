import {createEmailProvider} from '../send-order-doc/_deployed_shared/order-delivery/smtp.js';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Keep the verified SMTP transport and timeout behavior. The private PDF stays
// in Storage; the customer receives the browser signing link as the action.
export function createSignatureEmailProvider({user,password,createTransport,signingUrl}) {
 return createEmailProvider({user,password,createTransport:options=>{
  const transport=createTransport(options);
  return {
   close:()=>transport.close(),
   sendMail:message=>transport.sendMail({...message,attachments:undefined,
    text:message.text.replace('מצורף אישור ההזמנה','אישור ההזמנה זמין בקישור')+'\n\nלצפייה בהזמנה ולחתימה: '+signingUrl,
    html:'<div dir="rtl"><p>'+escape(message.text.replace('מצורף אישור ההזמנה','אישור ההזמנה זמין בקישור')).replace(/\n/g,'<br>')+'</p><p><a style="display:inline-block;padding:14px;background:#155e75;color:white" href="'+escape(signingUrl)+'">לצפייה בהזמנה ולחתימה</a></p></div>',
   }),
  };
 }});
}
