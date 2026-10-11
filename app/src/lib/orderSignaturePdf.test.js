// Real local Chromium PDFs; no provider requests or customer data.
import { describe, it, expect } from 'vitest';
import {RENDER_VERSION,canonicalJson,sha256} from '../../server/order-confirmation/contract.js';
import {createSignatureHandler} from '../../server/order-confirmation/handler.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import * as text from './orderDocText';
import { confirmationHtml, evidenceHtml, renderUnsigned, renderSigned } from '../../server/order-confirmation/renderer.js';

const url = 'https://example.test/order-sign#synthetic-test-capability';
const snapshot = {data:{id:'00000000-0000-4000-8000-000000000001',order_number:'QA-LOCAL',client_name:'לקוח בדיקה',total_price:120,vat_applicable:true,notes:'הערה ללקוח',internal_notes:'DO-NOT-RENDER',quotation_snapshot:{selected_activities:[{activity_name:'טיפוס',quantity:2,price_per_person:60,line_total:120}]}},text,renderVersion:RENDER_VERSION,acceptanceVersion:'1',acceptanceText:'אני מאשר/ת את אישור ההזמנה ותנאיו הכלליים בלבד.'};
const evidence = {fullName:'לקוח בדיקה',strokes:[[{x:.1,y:.1},{x:.4,y:.8},{x:.9,y:.2}]],signedAt:'2026-10-11T10:00:00Z',revisionId:snapshot.data.id,revisionHash:'a'.repeat(64),acceptanceText:snapshot.acceptanceText,acceptanceVersion:'1'};
snapshot.revisionId=evidence.revisionId;
const boundEvidence=(frozen,unsigned)=>({...evidence,snapshot:frozen,revisionHash:sha256(canonicalJson(frozen)),unsignedHash:sha256(unsigned)});

describe('confirmation PDF security and frozen copy',()=>{
 it('renders Hebrew frozen content and real anchor, without internal notes',()=>{
  const html=confirmationHtml(snapshot,url);
  expect(()=>confirmationHtml({...snapshot,renderVersion:'1'},url)).not.toThrow();
  expect(()=>confirmationHtml({...snapshot,renderVersion:'unsupported'},url)).toThrow('invalid_confirmation_snapshot');
  expect(html).toContain('dir="rtl"');expect(html).toContain('לקוח בדיקה');
  expect(html).toContain(`href="${url}"`);expect(html).toContain('הערה ללקוח');
  expect(html).not.toContain('DO-NOT-RENDER');
  expect(html).toContain(text.SAFETY_SIGNATURE);
 });
 it('escapes content and rejects unsafe signing URLs or incomplete snapshots',()=>{
  expect(confirmationHtml({...snapshot,data:{...snapshot.data,client_name:'<img src="https://evil.test">'}},url)).not.toContain('<img src="https://evil.test">');
  expect(()=>confirmationHtml(snapshot,'javascript:alert(1)')).toThrow();
  expect(()=>confirmationHtml({...snapshot,text:null},url)).toThrow();
  expect(()=>confirmationHtml({...snapshot,text:{...text,SAFETY_MINORS_TEXT:''}},url)).toThrow();
  expect(confirmationHtml({...snapshot,text:{...text,ORDER_TERMS:['frozen-vat-wording']}},url)).toContain('frozen-vat-wording');
 });
 it('replaces the signing CTA inside the full frozen confirmation before safety',()=>{
  const html=evidenceHtml(boundEvidence(snapshot,Buffer.from('fixture')));
  expect(RENDER_VERSION).toBe('3');
  expect(html.includes('<h1>אישור הזמנה</h1>')).toBe(true);
  expect(html).toContain('<h2>אישור וחתימה דיגיטלית</h2>');
  expect(html).toContain('נחתם בתאריך');
  expect(html.includes('<p>חתימה:</p><svg')).toBe(true);
  expect(html).not.toContain('class="sign-link"');
  expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('class="safety"'));
  expect(html).not.toContain('תעודת זהות');expect(html).not.toContain('היסטורית');expect(html).toContain('<svg');expect(html).toContain('לקוח בדיקה');
  expect(html.split(text.SAFETY_SIGNATURE)).toHaveLength(3);
  expect(()=>evidenceHtml({...boundEvidence(snapshot,Buffer.from('fixture')),strokes:[[{x:-1,y:0},{x:1,y:1}]]})).toThrow();
 });
 it('binds the exact frozen snapshot, revision and acceptance before rendering',async()=>{
  const bytes=Buffer.from('fixture'),valid=boundEvidence(snapshot,bytes);
  for(const changed of [{snapshot:{...snapshot,data:{...snapshot.data,total_price:1}}},{revisionHash:'0'.repeat(64)},{revisionId:'00000000-0000-4000-8000-000000000002'},{acceptanceText:'different'},{acceptanceVersion:'different'},{snapshot:undefined}]) {
   await expect(renderSigned(bytes,{...valid,...changed})).rejects.toThrow(/snapshot|revision|acceptance/);
  }
 });
});

function links(pdf){return pdf.getPages().flatMap(page=>{
 const annotations=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray);
 if(!annotations)return [];
 return annotations.asArray().flatMap(ref=>{const annotation=pdf.context.lookup(ref,PDFDict);const action=annotation.lookupMaybe(PDFName.of('A'),PDFDict);const uri=action?.lookup(PDFName.of('URI'));return uri instanceof PDFString?[uri.decodeText()]:[];});
});}

describe('real PDF artifacts',()=>{
 it('renders portable ink inside the confirmation and opens its actual page before safety',async()=>{
  const unsigned=await renderUnsigned(snapshot,url);
  const identity=boundEvidence(snapshot,unsigned);
  const signed=await renderSigned(unsigned,identity);
  const alternate=await renderSigned(unsigned,{...identity,strokes:[[{x:.1,y:.8},{x:.4,y:.1},{x:.9,y:.8}]]});
  const document=await PDFDocument.load(signed);
  const opening=document.catalog.lookup(PDFName.of('OpenAction'),PDFArray);
  const page=document.getPages().findIndex(p=>p.ref.toString()===opening.get(0).toString())+1;
  expect(page).toBeGreaterThan(0);expect(page).toBeLessThan(document.getPageCount());
  const acceptance=document.getPage(page-1);
  const objects=acceptance.node.Resources()?.lookupMaybe(PDFName.of('XObject'),PDFDict);
  const inkImage=ref=>{const obj=document.context.lookup(ref);return obj?.dict?.get(PDFName.of('Subtype'))?.toString()==='/Image'&&obj?.dict?.get(PDFName.of('Filter'))?.toString()!=='/DCTDecode';};
  expect(objects?.values().filter(inkImage),'acceptance ink must be embedded as a portable PNG').toHaveLength(1);
  // Raster differences must be dark ink, not PDF objects, metadata or merely
  // the presence of strokes in the renderer input. Both PDFs have identical text.
  const pixels=bytes=>execFileSync('pdftoppm',['-f',String(page),'-singlefile','-r','72','-'],{input:bytes,maxBuffer:5_000_000,timeout:20000});
  const a=pixels(signed),b=pixels(alternate);expect(a.length).toBe(b.length);
  let inkDifference=0;
  for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>80&&(a[i]<80||b[i]<80))inkDifference++;
  expect(inkDifference,'archived signature must produce visible ink in rendered PDF').toBeGreaterThan(500);
  // Remove only the embedded image pixels. Text, dimensions and page count
  // stay identical, so metadata or an empty image cannot pass the ink gate.
  const blankPdf=await PDFDocument.load(signed),inkPage=blankPdf.getPage(page-1);
  const resources=inkPage.node.Resources().lookup(PDFName.of('XObject'),PDFDict);
  for(const ref of resources.values()){
   const image=blankPdf.context.lookup(ref);
   if(image?.dict?.get(PDFName.of('Subtype'))?.toString()!=='/Image'||image.dict.get(PDFName.of('Filter'))?.toString()==='/DCTDecode')continue;
   const attributes=Object.fromEntries(image.dict.entries().filter(([key])=>!['/Length','/Filter','/DecodeParms','/SMask'].includes(key.toString())).map(([key,value])=>[key.toString().slice(1),value]));
   blankPdf.context.assign(ref,blankPdf.context.flateStream(Buffer.alloc(decodePDFRawStream(image).decode().length,255),attributes));
  }
  const blank=Buffer.from(await blankPdf.save());
  const crop=bytes=>execFileSync('pdftoppm',['-f',String(page),'-singlefile','-r','72','-'],{input:bytes,maxBuffer:5_000_000,timeout:20000});
  const background=crop(blank);
  const visibleInk=bytes=>{const rendered=crop(bytes);expect(rendered.length).toBe(background.length);let n=0;for(let i=0;i<rendered.length;i++)if(rendered[i]<80&&background[i]>200)n++;return n;};
  expect(visibleInk(signed),'visible non-background pixels in acceptance signature area').toBeGreaterThan(500);
  expect(visibleInk(blank),'blank embedded image must fail the ink gate').toBe(0);
  await expect(renderSigned(unsigned,{...identity,strokes:[]})).rejects.toThrow('invalid_signature');
  // Exercise the real response selector using two different real PDF artifacts.
  const row={id:snapshot.data.id,signed_path:'signed.pdf',unsigned_path:'unsigned.pdf',signed_hash:createHash('sha256').update(signed).digest('hex'),unsigned_hash:identity.unsignedHash};
  const handler=createSignatureHandler({rateLimit:async()=>true,authorize:async()=>snapshot.data.id,action:async()=>row,readPdf:async path=>path==='signed.pdf'?signed:unsigned});
  const request=new Request('https://example.test/api/order-confirmation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pdf',revisionId:row.id,signed:true})});
  const response=await handler(request);expect(response.status).toBe(200);
  const downloaded=Buffer.from(await response.arrayBuffer());
  expect(downloaded.equals(signed),'admin must download the exact signed archive').toBe(true);
  expect(downloaded.equals(unsigned)).toBe(false);expect(visibleInk(downloaded)).toBeGreaterThan(500);
  const extracted=execFileSync('pdftotext',['-f',String(page),'-l',String(page),'-','-'],{input:signed,maxBuffer:1_000_000,timeout:20000}).toString('utf8').replace(/[\u200e\u200f\u202a-\u202e]/g,'');
  expect(extracted).not.toContain('012345674');expect(extracted).not.toContain('היסטורית');
  const historical=await renderSigned(unsigned,{...identity,signerId:'012345674'});
  expect(execFileSync('pdftotext',['-','-'],{input:historical,maxBuffer:1_000_000,timeout:20000}).toString('utf8')).toContain('012345674');
  expect(extracted.includes(identity.fullName)||extracted.includes([...identity.fullName].reverse().join(''))).toBe(true);
  expect(extracted).toContain('11.10.2026');expect(extracted).toContain('13:00:00');
  expect(extracted.includes('חתימה')||extracted.includes('המיתח')).toBe(true);
  expect(extracted.includes('נחתם בתאריך')||extracted.includes([...'נחתם בתאריך'].reverse().join(''))).toBe(true);
  const allText=execFileSync('pdftotext',['-','-'],{input:signed,maxBuffer:1_000_000,timeout:20000}).toString('utf8').replace(/[\u200e\u200f\u202a-\u202e]/g,'');
  for(const phrase of ['לצפייה באישור ההזמנה ולחתימה דיגיטלית','המסמך המקורי מופיע בעמודים הקודמים']) {
   expect(allText).not.toContain(phrase);expect(allText).not.toContain([...phrase].reverse().join(''));
  }
  expect(links(document)).not.toContain(url);
 },60000);
 it.each(['1','2','3'])('signs historical version %s from its own frozen data without an appendix',async renderVersion=>{
  const frozen={...snapshot,renderVersion,text:{...text,ORDER_TERMS:['FROZEN_TERMS_MARKER',...text.ORDER_TERMS]},data:{...snapshot.data,notes:'FROZEN_CUSTOMER_NOTE'}};
  const unsigned=await renderUnsigned(frozen,url),signed=await renderSigned(unsigned,boundEvidence(frozen,unsigned));
  const extracted=execFileSync('pdftotext',['-','-'],{input:signed,maxBuffer:1_000_000,timeout:20000}).toString('utf8');
  expect(extracted).toContain('FROZEN_TERMS_MARKER');expect(extracted).toContain('FROZEN_CUSTOMER_NOTE');
  const document=await PDFDocument.load(signed),opening=document.catalog.lookup(PDFName.of('OpenAction'),PDFArray);
  const signaturePage=document.getPages().findIndex(p=>p.ref.toString()===opening.get(0).toString());
  expect(signaturePage).toBeLessThan(document.getPageCount()-1);
 },60000);
 it('paginates long RTL documents, keeps original bytes and replaces only the acceptance section',async()=>{
  const long={...snapshot,data:{...snapshot.data,quotation_snapshot:{selected_activities:Array.from({length:80},(_,i)=>({activity_name:`פעילות ${i+1} QA_ITEM_${i+1}`,quantity:2,price_per_person:60,line_total:120,description:'מידע שמור על הפעילות ללקוח '.repeat(20)}))}}};
  const unsigned=await renderUnsigned(long,url);
  const pdf=await PDFDocument.load(unsigned);expect(pdf.getPageCount()).toBeGreaterThan(5);
  expect(links(pdf)).toContain(url);
  const identity=boundEvidence(long,unsigned),signed=await renderSigned(unsigned,identity);
  const signedPdf=await PDFDocument.load(signed);
  expect(signedPdf.getPageCount()).toBeGreaterThan(5);
  expect(links(signedPdf)).not.toContain(url);
  const opening=signedPdf.catalog.lookup(PDFName.of('OpenAction'),PDFArray);
  const inkPage=signedPdf.getPages().findIndex(p=>p.ref.toString()===opening.get(0).toString());
  expect(inkPage).toBeGreaterThan(0);expect(inkPage).toBeLessThan(signedPdf.getPageCount()-1);
  const names=signedPdf.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray);
  const attachment=signedPdf.context.lookup(names.get(1),PDFDict).lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'),PDFRawStream);
  expect(Buffer.from(decodePDFRawStream(attachment).decode()).equals(unsigned)).toBe(true);
  // Poppler checks the rendered document rather than implementation strings.
  const extracted=execFileSync('pdftotext',['-','-'],{input:signed,maxBuffer:5_000_000}).toString('utf8');
  expect(extracted).toContain('QA_ITEM_80');
  const normalized=extracted.replace(/[\u200e\u200f\u202a-\u202e]/g,'');
  expect(normalized.includes(evidence.fullName)||normalized.includes([...evidence.fullName].reverse().join(''))).toBe(true);
  expect(extracted).not.toContain('DO-NOT-RENDER');
  const pixels=bytes=>execFileSync('pdftoppm',['-f','1','-singlefile','-scale-to','1000','-png','-'],{input:bytes,maxBuffer:5_000_000});
  expect(pixels(signed).equals(pixels(unsigned))).toBe(true);
  await expect(renderSigned(unsigned,{...identity,unsignedHash:'0'.repeat(64)})).rejects.toThrow('unsigned_artifact_hash_mismatch');
 },60000);
});
