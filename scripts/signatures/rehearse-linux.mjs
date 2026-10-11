// Run in an isolated Linux copy, with networking disabled. Synthetic data only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {renderUnsigned,renderSigned} from '../../app/server/order-confirmation/renderer.js';
import {sha256,ACCEPTANCE_TEXT} from '../../app/server/order-confirmation/contract.js';
import * as text from '../../app/src/lib/orderDocText.js';
const require=createRequire(new URL('../../app/package.json',import.meta.url));
const {PDFDocument,PDFName,PDFDict,PDFArray,PDFString,PDFHexString,PDFRawStream,decodePDFRawStream}=require('pdf-lib');
assert.equal(process.platform,'linux');
assert.equal(process.env.CONFIRMATION_CHROMIUM_PATH,undefined,'Must use packaged Chromium');
for(const key of ['SUPABASE_SERVICE_ROLE_KEY','SUPABASE_URL','VITE_SUPABASE_URL'])assert.equal(process.env[key],undefined,'No production configuration');
const out=resolve(process.argv[2]||'artifacts');mkdirSync(out,{recursive:true});
const signingUrl='https://signature-qa.invalid/order-sign#'+'s'.repeat(43);
const snapshot={revisionId:'00000000-0000-4000-8000-000000000001',revisionNumber:1,renderVersion:'1',acceptanceVersion:'1',acceptanceText:ACCEPTANCE_TEXT,text,
 data:{order_number:'QA-LINUX-ONLY',client_name:'לקוח בדיקה בלבד',created_at:'2026-10-11T10:00:00Z',vat_applicable:true,total_price:9600,notes:'מסמך בדיקה סינתטי — אינו הזמנה אמיתית',quotation_snapshot:{selected_activities:Array.from({length:80},(_,i)=>({activity_name:`פעילות ${i+1} QA_ITEM_${i+1}`,quantity:2,price_per_person:60,line_total:120,description:'מידע ללקוח על פעילות בדיקה '.repeat(20)}))}}};
const evidence={fullName:'ישראל בדיקה',strokes:[[{x:.1,y:.7},{x:.25,y:.2},{x:.3,y:.8},{x:.45,y:.3},{x:.7,y:.6},{x:.9,y:.2}]],signedAt:'2026-10-11T10:00:00Z',revisionId:snapshot.revisionId,revisionHash:sha256(JSON.stringify(snapshot)),acceptanceText:ACCEPTANCE_TEXT,acceptanceVersion:'1'};
function links(pdf){return pdf.getPages().flatMap(page=>{
 const annotations=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray);
 return (annotations?.asArray()||[]).flatMap(ref=>{const action=pdf.context.lookup(ref,PDFDict).lookupMaybe(PDFName.of('A'),PDFDict),uri=action?.lookup(PDFName.of('URI'));return uri instanceof PDFString||uri instanceof PDFHexString?[uri.decodeText()]:[];});
});}
const started=performance.now();
const unsigned=await renderUnsigned(snapshot,signingUrl),unsignedMs=performance.now()-started;
evidence.unsignedHash=sha256(unsigned);
const signedStart=performance.now(),signed=await renderSigned(unsigned,evidence),signedMs=performance.now()-signedStart;
const a=await PDFDocument.load(unsigned),b=await PDFDocument.load(signed);
assert(a.getPageCount()>5);assert(b.getPageCount()>a.getPageCount());
assert(a.getPages().some(page=>page.node.Resources()?.lookupMaybe(PDFName.of('Font'),PDFDict)?.keys().length),'PDF has no text fonts: check standard /tmp fontconfig paths');
assert(links(a).includes(signingUrl));assert(links(b).includes(signingUrl));
const names=b.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray);
const stream=b.context.lookup(names.get(1),PDFDict).lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'),PDFRawStream);
assert(Buffer.from(decodePDFRawStream(stream).decode()).equals(unsigned));
await assert.rejects(renderSigned(unsigned,{...evidence,unsignedHash:'0'.repeat(64)}),/unsigned_artifact_hash_mismatch/);
writeFileSync(resolve(out,'unsigned.pdf'),unsigned);writeFileSync(resolve(out,'signed.pdf'),signed);
const result={node:process.version,platform:process.platform,arch:process.arch,unsignedMs:Math.round(unsignedMs),signedMs:Math.round(signedMs),unsignedPages:a.getPageCount(),signedPages:b.getPageCount(),unsignedBytes:unsigned.length,signedBytes:signed.length,unsignedHash:evidence.unsignedHash,signedHash:sha256(signed),linkInBoth:true,originalEmbeddedExactly:true,badHashRejected:true};
writeFileSync(resolve(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
