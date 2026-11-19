import {describe,it,expect,vi} from 'vitest';
import {createSignatureEmailProvider} from './email.js';
import {createEmailProvider} from '../send-order-doc/_deployed_shared/order-delivery/smtp.js';
import {createWhatsappProvider,TEMPLATE_BODY} from '../send-order-doc/_deployed_shared/order-delivery/template.js';
const pdf=Buffer.from('%PDF-synthetic-local-only');
const message={destination:'test@example.invalid',pdfBytes:pdf,clientName:'Synthetic Customer',orderNumber:'QA-1',fileName:'order-QA-1.pdf'};
const link='https://example.invalid/order-sign#'+'a'.repeat(43);
describe('existing transport regression and revision links',()=>{
 it('keeps SMTP attachment/security settings and adds prominent escaped link',async()=>{
  const transport={sendMail:vi.fn(async()=>({accepted:[message.destination],messageId:'synthetic-id'})),close:vi.fn()};
  const factory=vi.fn(()=>transport);
  const provider=createSignatureEmailProvider({user:'sender@example.invalid',password:'synthetic-only',createTransport:factory,signingUrl:link});
  await provider.send({...message,clientName:'<script>bad</script>'});
  const sent=transport.sendMail.mock.calls[0][0];
  expect(sent.attachments[0].content.equals(pdf)).toBe(true);expect(sent.attachments[0].contentType).toBe('application/pdf');
  expect(sent.text).toContain(link);expect(sent.html).toContain(`href="${link}"`);expect(sent.html).not.toContain('<script>');
  expect(sent.disableFileAccess).toBe(true);expect(sent.disableUrlAccess).toBe(true);
  expect(factory.mock.calls[0][0]).toMatchObject({port:465,secure:true,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}});expect(transport.close).toHaveBeenCalledOnce();
 });
 it('leaves legacy email behavior intact',async()=>{
  const transport={sendMail:vi.fn(async()=>({accepted:[message.destination],messageId:'legacy-id'})),close:vi.fn()};
  await createEmailProvider({user:'sender@example.invalid',password:'synthetic-only',createTransport:()=>transport}).send(message);
  const sent=transport.sendMail.mock.calls[0][0];expect(sent.html).toBeUndefined();expect(sent.attachments[0].content.equals(pdf)).toBe(true);
 });
 it('uses unchanged approved WhatsApp document header plus exactly three body parameters',async()=>{
  const fetchImpl=vi.fn(async(url,options)=>{
   if(url.includes('message_templates'))return Response.json({data:[{name:'order_confirmation_pdf',language:'he',category:'UTILITY',status:'APPROVED',components:[{type:'HEADER',format:'DOCUMENT'},{type:'BODY',text:TEMPLATE_BODY}]}]});
   if(url.endsWith('/media'))return Response.json({id:'12345'});
   return Response.json({messages:[{id:'synthetic-message'}],contacts:[{wa_id:'972500000000'}]});
  });
  const provider=createWhatsappProvider({token:'synthetic-only',phoneId:'1',wabaId:'2',fetchImpl});
  expect((await provider.capabilities()).canSend).toBe(true);
  await provider.send({...message,destination:'972500000000',activityDate:'11/10/2026'});
  const upload=fetchImpl.mock.calls.find(([url])=>url.endsWith('/media'))[1].body;
  expect(Buffer.from(await upload.get('file').arrayBuffer()).equals(pdf)).toBe(true);
  const payload=JSON.parse(fetchImpl.mock.calls.find(([url])=>url.endsWith('/messages'))[1].body);
  expect(payload.template.name).toBe('order_confirmation_pdf');expect(payload.template.language.code).toBe('he');
  expect(payload.template.components).toHaveLength(2);
  expect(payload.template.components[0]).toEqual({type:'header',parameters:[{type:'document',document:{id:'12345',filename:message.fileName}}]});
  expect(payload.template.components[1].parameters.map(p=>p.text)).toEqual([message.clientName,message.orderNumber,'11/10/2026']);
 });
});
