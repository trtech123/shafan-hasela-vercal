// Real local Chromium PDFs; no provider requests or customer data.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import * as text from './orderDocText';
import { confirmationHtml, evidenceHtml, renderUnsigned, renderSigned } from '../../server/order-confirmation/renderer.js';

const url = 'https://example.test/order-sign#synthetic-test-capability';
const snapshot = {data:{id:'00000000-0000-4000-8000-000000000001',order_number:'QA-LOCAL',client_name:'לקוח בדיקה',total_price:120,vat_applicable:true,notes:'הערה ללקוח',internal_notes:'DO-NOT-RENDER',quotation_snapshot:{selected_activities:[{activity_name:'טיפוס',quantity:2,price_per_person:60,line_total:120}]}},text,renderVersion:'1',acceptanceVersion:'1',acceptanceText:'אני מאשר/ת את אישור ההזמנה ותנאיו הכלליים בלבד.'};
const evidence = {fullName:'לקוח בדיקה',strokes:[[{x:.1,y:.1},{x:.4,y:.8},{x:.9,y:.2}]],signedAt:'2026-10-11T10:00:00Z',revisionId:snapshot.data.id,revisionHash:'a'.repeat(64),acceptanceText:snapshot.acceptanceText,acceptanceVersion:'1'};

describe('confirmation PDF security and frozen copy',()=>{
 it('renders Hebrew frozen content and real anchor, without internal notes',()=>{
  const html=confirmationHtml(snapshot,url);
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
 it('limits signature to a separate acceptance evidence page',()=>{
  const html=evidenceHtml({...evidence,unsignedHash:'b'.repeat(64)});
  expect(html).not.toContain('תעודת זהות');expect(html).not.toContain('היסטורית');expect(html).toContain('<svg');expect(html).toContain('לקוח בדיקה');
  expect(html).not.toContain(text.SAFETY_SIGNATURE);
  expect(()=>evidenceHtml({...evidence,strokes:[[{x:-1,y:0},{x:1,y:1}]]})).toThrow();
 });
});

function links(pdf){return pdf.getPages().flatMap(page=>{
 const annotations=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray);
 if(!annotations)return [];
 return annotations.asArray().flatMap(ref=>{const annotation=pdf.context.lookup(ref,PDFDict);const action=annotation.lookupMaybe(PDFName.of('A'),PDFDict);const uri=action?.lookup(PDFName.of('URI'));return uri instanceof PDFString?[uri.decodeText()]:[];});
});}

describe('real PDF artifacts',()=>{
 it('renders actual signature ink and signer identity in the archived acceptance page',async()=>{
  const unsigned=await renderUnsigned(snapshot,url);
  const identity={...evidence,unsignedHash:createHash('sha256').update(unsigned).digest('hex')};
  const signed=await renderSigned(unsigned,identity);
  const alternate=await renderSigned(unsigned,{...identity,strokes:[[{x:.1,y:.8},{x:.4,y:.1},{x:.9,y:.8}]]});
  const page=(await PDFDocument.load(signed)).getPageCount();
  const appendix=(await PDFDocument.load(signed)).getPages().at(-1);
  const objects=appendix.node.Resources()?.lookupMaybe(PDFName.of('XObject'),PDFDict);
  expect(objects?.values().some(ref=>appendix.doc.context.lookup(ref)?.dict?.get(PDFName.of('Subtype'))?.toString()==='/Image'),'acceptance ink must be embedded as a portable image').toBe(true);
  // Raster differences must be dark ink, not PDF objects, metadata or merely
  // the presence of strokes in the renderer input. Both PDFs have identical text.
  const pixels=bytes=>execFileSync('pdftoppm',['-f',String(page),'-singlefile','-r','72','-'],{input:bytes,maxBuffer:5_000_000,timeout:20000});
  const a=pixels(signed),b=pixels(alternate);expect(a.length).toBe(b.length);
  let inkDifference=0;
  for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>80&&(a[i]<80||b[i]<80))inkDifference++;
  expect(inkDifference,'archived signature must produce visible ink in rendered PDF').toBeGreaterThan(500);
  const extracted=execFileSync('pdftotext',['-f',String(page),'-','-'],{input:signed,maxBuffer:1_000_000,timeout:20000}).toString('utf8').replace(/[\u200e\u200f\u202a-\u202e]/g,'');
  expect(extracted).not.toContain('012345674');expect(extracted).not.toContain('היסטורית');
  const historical=await renderSigned(unsigned,{...identity,signerId:'012345674'});
  expect(execFileSync('pdftotext',['-','-'],{input:historical,maxBuffer:1_000_000,timeout:20000}).toString('utf8')).toContain('012345674');
  expect(extracted.includes(identity.fullName)||extracted.includes([...identity.fullName].reverse().join(''))).toBe(true);
  expect(extracted).toContain('11.10.2026');expect(extracted).toContain('13:00:00');
  expect(extracted.includes('חתימה')||extracted.includes('המיתח')).toBe(true);
 },60000);
 it('creates clickable link annotations, paginates long RTL documents, appends signed evidence to original',async()=>{
  const long={...snapshot,data:{...snapshot.data,quotation_snapshot:{selected_activities:Array.from({length:80},(_,i)=>({activity_name:`פעילות ${i+1} QA_ITEM_${i+1}`,quantity:2,price_per_person:60,line_total:120,description:'מידע שמור על הפעילות ללקוח '.repeat(20)}))}}};
  const unsigned=await renderUnsigned(long,url);
  const pdf=await PDFDocument.load(unsigned);expect(pdf.getPageCount()).toBeGreaterThan(5);
  expect(links(pdf)).toContain(url);
  const unsignedHash=createHash('sha256').update(unsigned).digest('hex');
  const signed=await renderSigned(unsigned,{...evidence,unsignedHash});
  const signedPdf=await PDFDocument.load(signed);
  expect(signedPdf.getPageCount()).toBeGreaterThan(pdf.getPageCount());
  expect(links(signedPdf)).toContain(url);
  const names=signedPdf.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray);
  const attachment=signedPdf.context.lookup(names.get(1),PDFDict).lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'),PDFRawStream);
  expect(Buffer.from(decodePDFRawStream(attachment).decode()).equals(unsigned)).toBe(true);
  // Poppler checks the rendered document rather than implementation strings.
  const extracted=execFileSync('pdftotext',['-','-'],{input:signed,maxBuffer:5_000_000}).toString('utf8');
  expect(extracted).toContain('QA_ITEM_80');
  const normalized=extracted.replace(/[\u200e\u200f\u202a-\u202e]/g,'');
  expect(normalized.includes(evidence.fullName)||normalized.includes([...evidence.fullName].reverse().join(''))).toBe(true);
  expect(extracted).toContain(evidence.revisionHash);expect(extracted).toContain(evidence.unsignedHash || unsignedHash);
  const pixels=bytes=>execFileSync('pdftoppm',['-f','1','-singlefile','-scale-to','1000','-png','-'],{input:bytes,maxBuffer:5_000_000});
  expect(pixels(signed).equals(pixels(unsigned))).toBe(true);
  await expect(renderSigned(unsigned,{...evidence,unsignedHash:'0'.repeat(64)})).rejects.toThrow();
 },60000);
});
