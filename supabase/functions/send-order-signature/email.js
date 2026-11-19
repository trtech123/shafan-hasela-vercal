import {createEmailProvider} from '../send-order-doc/_deployed_shared/order-delivery/smtp.js';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Keep the verified SMTP transport/attachment/timeout behavior. The handler has
// already bound this HTTPS link to the exact private revision being delivered.
export function createSignatureEmailProvider({user,password,createTransport,signingUrl}) {
 return createEmailProvider({user,password,createTransport:options=>{
  const transport=createTransport(options);
  return {
   close:()=>transport.close(),
   sendMail:message=>transport.sendMail({...message,
    text:message.text+'\n\nלצפייה בהזמנה ולחתימה: '+signingUrl,
    html:'<div dir="rtl"><p>'+escape(message.text).replace(/\n/g,'<br>')+'</p><p><a style="display:inline-block;padding:14px;background:#155e75;color:white" href="'+escape(signingUrl)+'">לצפייה בהזמנה ולחתימה</a></p></div>',
   }),
  };
 }});
}
