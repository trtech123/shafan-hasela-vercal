// Run in an isolated Linux copy, with networking disabled. Synthetic data only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {renderUnsigned,renderSigned} from '../../app/server/order-confirmation/renderer.js';
import {sha256,canonicalJson,ACCEPTANCE_TEXT,RENDER_VERSION} from '../../app/server/order-confirmation/contract.js';
import * as text from '../../app/src/lib/orderDocText.js';
const require=createRequire(new URL('../../app/package.json',import.meta.url));
const {PDFDocument,PDFName,PDFDict,PDFArray,PDFString,PDFHexString,PDFRawStream,decodePDFRawStream}=require('pdf-lib');
assert.equal(process.platform,'linux');
assert.equal(process.env.CONFIRMATION_CHROMIUM_PATH,undefined,'Must use packaged Chromium');
for(const key of ['SUPABASE_SERVICE_ROLE_KEY','SUPABASE_URL','VITE_SUPABASE_URL'])assert.equal(process.env[key],undefined,'No production configuration');
const out=resolve(process.argv[2]||'artifacts');mkdirSync(out,{recursive:true});
const signingUrl='https://signature-qa.invalid/order-sign#'+'s'.repeat(43);
const snapshot={revisionId:'00000000-0000-4000-8000-000000000001',revisionNumber:1,renderVersion:RENDER_VERSION,acceptanceVersion:'1',acceptanceText:ACCEPTANCE_TEXT,text,
 data:{order_number:'QA-LINUX-ONLY',client_name:'לקוח בדיקה בלבד',created_at:'2026-10-11T10:00:00Z',vat_applicable:true,total_price:9600,notes:'מסמך בדיקה סינתטי — אינו הזמנה אמיתית',quotation_snapshot:{selected_activities:Array.from({length:80},(_,i)=>({activity_name:`פעילות ${i+1} QA_ITEM_${i+1}`,quantity:2,price_per_person:60,line_total:120,description:'מידע ללקוח על פעילות בדיקה '.repeat(20)}))}}};
const evidence={fullName:'ישראל בדיקה',strokes:[[{x:.1,y:.7},{x:.25,y:.2},{x:.3,y:.8},{x:.45,y:.3},{x:.7,y:.6},{x:.9,y:.2}]],signedAt:'2026-10-11T10:00:00Z',revisionId:snapshot.revisionId,snapshot,revisionHash:sha256(canonicalJson(snapshot)),acceptanceText:ACCEPTANCE_TEXT,acceptanceVersion:'1'};
function links(pdf){return pdf.getPages().flatMap(page=>{
 const annotations=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray);
 return (annotations?.asArray()||[]).flatMap(ref=>{const action=pdf.context.lookup(ref,PDFDict).lookupMaybe(PDFName.of('A'),PDFDict),uri=action?.lookup(PDFName.of('URI'));return uri instanceof PDFString||uri instanceof PDFHexString?[uri.decodeText()]:[];});
});}
const started=performance.now();
const unsigned=await renderUnsigned(snapshot,signingUrl),unsignedMs=performance.now()-started;
evidence.unsignedHash=sha256(unsigned);
const signedStart=performance.now(),signed=await renderSigned(unsigned,evidence),signedMs=performance.now()-signedStart;
const a=await PDFDocument.load(unsigned),b=await PDFDocument.load(signed);
assert(a.getPageCount()>5);assert(b.getPageCount()>5);
assert(a.getPages().some(page=>page.node.Resources()?.lookupMaybe(PDFName.of('Font'),PDFDict)?.keys().length),'PDF has no text fonts: check standard /tmp fontconfig paths');
assert(links(a).includes(signingUrl));assert(!links(b).includes(signingUrl));
const destination=b.catalog.lookup(PDFName.of('OpenAction'),PDFArray).get(0);
const inkPageNumber=b.getPages().findIndex(page=>page.ref.toString()===destination.toString())+1;assert(inkPageNumber>0&&inkPageNumber<b.getPageCount());
const names=b.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray);
const stream=b.context.lookup(names.get(1),PDFDict).lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'),PDFRawStream);
assert(Buffer.from(decodePDFRawStream(stream).decode()).equals(unsigned));
const alternate=await renderSigned(unsigned,{...evidence,strokes:[[{x:.1,y:.1},{x:.5,y:.9},{x:.9,y:.1}]]});
const pixels=bytes=>execFileSync('pdftoppm',['-f',String(inkPageNumber),'-singlefile','-r','72','-'],{input:bytes,maxBuffer:5_000_000,timeout:20000});
const raster=pixels(signed),other=pixels(alternate);assert.equal(raster.length,other.length);
let inkDifference=0;for(let i=0;i<raster.length;i++)if(Math.abs(raster[i]-other[i])>80&&(raster[i]<80||other[i]<80))inkDifference++;
assert(inkDifference>500,'Signature evidence exists but visible ink is absent');
const appendix=b.getPage(inkPageNumber-1),images=appendix.node.Resources()?.lookupMaybe(PDFName.of('XObject'),PDFDict);
assert(images?.values().some(ref=>b.context.lookup(ref)?.dict?.get(PDFName.of('Subtype'))?.toString()==='/Image'),'Missing portable signature image');
assert.equal(b.catalog.lookup(PDFName.of('OpenAction'),PDFArray).get(0).toString(),appendix.ref.toString());
const blankPdf=await PDFDocument.load(signed),blankResources=blankPdf.getPage(inkPageNumber-1).node.Resources().lookup(PDFName.of('XObject'),PDFDict);
for(const ref of blankResources.values()){
 const image=blankPdf.context.lookup(ref);
 if(image?.dict?.get(PDFName.of('Subtype'))?.toString()!=='/Image'||image.dict.get(PDFName.of('Filter'))?.toString()==='/DCTDecode')continue;
 const attributes=Object.fromEntries(image.dict.entries().filter(([key])=>!['/Length','/Filter','/DecodeParms','/SMask'].includes(key.toString())).map(([key,value])=>[key.toString().slice(1),value]));
 blankPdf.context.assign(ref,blankPdf.context.flateStream(Buffer.alloc(decodePDFRawStream(image).decode().length,255),attributes));
}
const blank=Buffer.from(await blankPdf.save());
const crop=bytes=>execFileSync('pdftoppm',['-f',String(inkPageNumber),'-singlefile','-r','72','-'],{input:bytes,maxBuffer:5_000_000,timeout:20000});
const background=crop(blank);
const visibleInk=bytes=>{const pixels=crop(bytes);assert.equal(pixels.length,background.length);let n=0;for(let i=0;i<pixels.length;i++)if(pixels[i]<80&&background[i]>200)n++;return n;};
assert(visibleInk(signed)>500,'No non-background ink in expected signature area');assert.equal(visibleInk(blank),0,'Blank image must fail ink verification');
console.log(JSON.stringify({signatureAreaInkChannels:visibleInk(signed),blankImageRejected:true,opensOnSignaturePage:true}));
const extracted=execFileSync('pdftotext',['-f',String(inkPageNumber),'-l',String(inkPageNumber),'-','-'],{input:signed,maxBuffer:5_000_000,timeout:20000}).toString('utf8').replace(/[\u200e\u200f\u202a-\u202e]/g,'');
assert(!extracted.includes('012345674'));assert(!extracted.includes('היסטורית')&&!extracted.includes('תירוטסיה'));assert(!extracted.includes('תעודת זהות')&&!extracted.includes('תוהז תדועת'));
const historical=await renderSigned(unsigned,{...evidence,signerId:'012345674'});
const historicalText=execFileSync('pdftotext',['-','-'],{input:historical,maxBuffer:5_000_000,timeout:20000}).toString('utf8');assert(historicalText.includes('012345674'));
assert(extracted.includes(evidence.fullName)||extracted.includes([...evidence.fullName].reverse().join('')));
assert(extracted.includes('11.10.2026')&&extracted.includes('13:00:00'));
console.log(JSON.stringify({signatureRasterImage:true,visibleInkDifference:inkDifference,noNewSignerId:true,historicalIdDisplayed:true,signerNameTimestampInPdf:true}));
await assert.rejects(renderSigned(unsigned,{...evidence,unsignedHash:'0'.repeat(64)}),/unsigned_artifact_hash_mismatch/);
writeFileSync(resolve(out,'unsigned.pdf'),unsigned);writeFileSync(resolve(out,'signed.pdf'),signed);
const result={node:process.version,platform:process.platform,arch:process.arch,unsignedMs:Math.round(unsignedMs),signedMs:Math.round(signedMs),unsignedPages:a.getPageCount(),signedPages:b.getPageCount(),unsignedBytes:unsigned.length,signedBytes:signed.length,unsignedHash:evidence.unsignedHash,signedHash:sha256(signed),unsignedLink:true,signedCtaAbsent:true,signaturePage:inkPageNumber,originalEmbeddedExactly:true,badHashRejected:true};
writeFileSync(resolve(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
