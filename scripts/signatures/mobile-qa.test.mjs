import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {bundle,fixture,handler} from './mobile-qa.mjs';
const {PDFDocument,PDFName,PDFArray,PDFDict,PDFString}=createRequire(new URL('../../app/package.json',import.meta.url))('pdf-lib');
const origin='https://127.0.0.1:4188';
test('isolated bundle and bounded synthetic API',async()=>{
 const files=await bundle();
 assert(files.has('/mobile-qa.html'));
 assert([...files.keys()].some(x=>x.endsWith('.css')));
 const js=[...files].filter(([name])=>name.endsWith('.js')).map(([,value])=>value.toString()).join('');
 assert(!js.includes('supabase.co'));assert(!js.includes('fonts.googleapis.com'));assert(!js.includes('VITE_SUPABASE'));assert(!js.includes('sourceMappingURL'));
 const state=await fixture(origin);
 const pdf=await PDFDocument.load(state.pdf);
 const links=pdf.getPages().flatMap(page=>(page.node.lookupMaybe(PDFName.of('Annots'),PDFArray)?.asArray()||[]).flatMap(ref=>{
  const action=pdf.context.lookup(ref,PDFDict).lookupMaybe(PDFName.of('A'),PDFDict);
  const uri=action?.lookup(PDFName.of('URI'));return uri instanceof PDFString?[uri.decodeText()]:[];
 }));
 assert(pdf.getPageCount()>=2);
 const uri=links.find(link=>link.startsWith(`${origin}/order-sign#`));
 assert(uri,'Production renderer must create HTTPS signing annotation');
 assert(uri.startsWith(`${origin}/order-sign#`));
 const token=new URL(uri).hash.slice(1);assert.match(token,/^[A-Za-z0-9_-]{43}$/);
 const serve=handler(origin,files,state);
 async function request(url,method='GET',body,headers={}){
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url,method,headers:{host:'127.0.0.1:4188',origin,...headers}});
  let result;await serve(req,{setHeader(){},writeHead(status,h){result={status,headers:h};},end(body){result.body=body;}});return result;
 }
 assert.equal((await request('/')).status,200);assert.equal((await request('/fixture.pdf')).status,200);
 assert.equal((await request('/order-sign')).status,200);
 for(const path of ['/.env','/@fs/C:/Users/nadav/.env','/src/pages/OrderSignature.jsx','/../../app/.env'])assert.equal((await request(path)).status,404);
 assert.equal((await request('/','DELETE')).status,405);
 assert.equal((await request('/','GET',null,{host:'evil.test'})).status,421);
 assert.equal((await request('/api/order-confirmation','POST',{action:'view',token},{origin:'https://evil.test'})).status,403);
 assert.equal((await request('/api/order-confirmation','POST',{action:'view',token:'wrong'})).status,404);
 const submission={action:'sign',token,fullName:'Mobile Tester',accepted:true,requestId:'00000000-0000-4000-8000-000000000002',strokes:[[{x:.1,y:.1},{x:.8,y:.8}]]};
 for(const signerId of ['','012345675','123456782'])assert.equal((await request('/api/order-confirmation','POST',{...submission,signerId})).status,400);
 assert.equal((await request('/api/order-confirmation','POST',{...submission,fullName:'Real Person'})).status,400);
 assert.equal((await request('/api/order-confirmation','POST',submission)).status,200);
 assert.equal(JSON.parse((await request('/api/order-confirmation','POST',{action:'view',token})).body).signed,true);
});
