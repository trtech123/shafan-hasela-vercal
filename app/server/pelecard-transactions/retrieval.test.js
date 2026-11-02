import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeResponse} from './normalize.js';
import {validateInput,localTime} from './validation.js';
import {createHandler} from './handler.js';
import {authenticateAdmin} from './auth.js';
import {queryProvider} from './provider.js';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';

const now=()=>Date.parse('2026-10-04T14:00:00Z');
const range={action:'range',start:'2026-10-04T13:10',end:'2026-10-04T13:40'};
const row=(extra={})=>({PelecardTransactionId:3129236152,CreatedDate:'04/10/2026 13:24:28',DebitTotal:'100',DebitCurrency:'1',ShvaResult:'000',JParam:'4',DebitType:'1',VoucherId:'28-001-001',DebitApproveNumber:'0081108',...extra});
const response=rows=>({StatusCode:'000',ResultData:rows});
const normalized=rows=>normalizeResponse(response(rows),'fixture-scope',validateInput(range,now()));
const origin='https://shafan-hasela-vercal.vercel.app';
const req=(body=range,headers={})=>new Request(origin+'/api/pelecard-transactions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer fixture',...headers},body:JSON.stringify(body)});
const read=name=>({PELECARD_RETRIEVAL_ENABLED:'true',PELECARD_RETRIEVAL_SCOPE_ID:'fixture-scope',PELECARD_LIVE_TERMINAL:'fixture-terminal',PELECARD_LIVE_USER:'fixture-user',PELECARD_LIVE_PASSWORD:'fixture-password'})[name];

test('normalizes stable scoped identity, minor units, timestamp and missing customer fields',()=>{
 const [r]=normalized([row()]);assert.equal(r.id,'pelecard:fixture-scope:3129236152');assert.equal(r.amountMinor,100);assert.equal(r.currency,'ILS');assert.equal(r.occurredAt,'2026-10-04T10:24:28.000Z');assert.equal(r.status,'succeeded');assert.equal(r.operation,'charge');assert.deepEqual(r.customer,{name:null,email:null,phone:null,cardholderId:null});
});
test('only allowlisted fields escape even nested sensitive provider payloads',()=>{
 const [r]=normalized([row({CreditCardNumber:'4111111111111111',CVV:'999',CreditCardExpDate:'1230',token:'secret-token',ConfirmationKey:'secret-confirmation',raw:{password:'secret-password'},CardHolderName:'Synthetic Name',CardHolderEmail:'fixture@example.test',CardHolderPhone:'0501234567',CardHolderID:'123456789'})]);
 assert.deepEqual(r.customer,{name:'Synthetic Name',email:'fixture@example.test',phone:'0501234567',cardholderId:'123456789'});
 const out=JSON.stringify(r);for(const value of ['4111111111111111','999','1230','secret-','CreditCard','CVV','ConfirmationKey','password'])assert.ok(!out.includes(value));
 assert.equal(normalized([row({CardHolderName:{PAN:'4111111111111111'},CardHolderEmail:' ',CardHolderID:'4111111111111111'})])[0].customer.name,null);
 assert.equal(normalized([row({CardHolderID:'4111111111111111'})])[0].customer.cardholderId,null);
});
test('duplicates collapse but conflicting duplicate identities fail',()=>{
 assert.equal(normalized([row(),row()]).length,1);assert.throws(()=>normalized([row(),row({DebitTotal:'200'})]),/conflicting_provider_records/);
});
test('credential echoes in otherwise allowlisted fields are rejected without exposing the value',()=>{
 assert.throws(()=>normalizeResponse(response([row({CardHolderName:'fixture-secret'})]),'fixture-scope',validateInput(range,now()),['fixture-secret']),/invalid_provider_response/);
});
test('failure, authorization, cancellation and unknown currencies do not become successful charges',()=>{
 assert.equal(normalized([row({ShvaResult:'003'})])[0].status,'failed');
 assert.equal(normalized([row({ShvaResult:'00'})])[0].status,'unknown');
 assert.equal(normalized([row({JParam:'5'})])[0].operation,'authorization');
 assert.equal(normalized([row({DebitType:'52'})])[0].operation,'cancellation');
 assert.equal(normalized([row({DebitCurrency:'0'})])[0].currency,null);
 assert.equal(normalized([row({JParam:'99',DebitType:'99'})])[0].operation,'unknown');
});
test('bounds records, rejects mismatched detail ID and never reports provider failure as an empty list',()=>{
 assert.throws(()=>normalized(Array.from({length:501},()=>row())),/range_too_large/);
 assert.throws(()=>normalizeResponse(response(row()),'fixture-scope',{action:'lookup',transactionId:'999'}),/invalid_provider_response/);
 assert.throws(()=>normalizeResponse({StatusCode:'999',ErrorMessage:'private'},'fixture-scope',{action:'lookup',transactionId:'999'}),/provider_unavailable/);
 assert.deepEqual(normalized([]),[]);
});
test('validates actual dates, max 31 days, future ranges, exact numeric identifiers and extra keys',()=>{
 assert.equal(validateInput(range,now()).startDate,'04/10/2026 13:10');
 for(const input of [{...range,start:'2026-02-30T12:00'}, {...range,start:'2026-01-01T12:00'}, {...range,end:'2026-10-05T12:00'}, {...range,start:range.end,end:range.start}, {...range,endpoint:'init'}, {action:'lookup',transactionId:'1e10'}, {action:'hosted',transactionId:'11111111-1111-4111-8111-111111111111'}])assert.throws(()=>validateInput(input,now()),/invalid_request/);
 assert.equal(validateInput({action:'lookup',transactionId:'3129236152'},now()).transactionId,'3129236152');
});
test('Israel DST gaps and folds are rejected for queries and never invented for provider timestamps',()=>{
 assert.throws(()=>validateInput({...range,start:'2026-03-27T02:30'},now()),/invalid_request/);
 assert.throws(()=>validateInput({action:'range',start:'2026-10-25T01:30',end:'2026-10-25T03:00'},Date.parse('2026-11-01')),/invalid_request/);
 assert.equal(localTime('2026-10-25T01:30:00').instant,null);
});
test('admin-only, fail-closed kill switch and safe error envelopes prevent provider calls',async()=>{
 for(const [role,enabled,status] of [[null,'true',401],['cashier','true',403],['operations','true',403],['admin','false',503]]){
  let calls=0;const h=createHandler({read:n=>n==='PELECARD_RETRIEVAL_ENABLED'?enabled:read(n),authenticate:async()=>role,query:async()=>{calls++;return response([])},now});
  const r=await h(req());assert.equal(r.status,status);assert.equal(calls,0);assert.equal(r.headers.get('cache-control'),'no-store');
 }
 const h=createHandler({read,authenticate:async()=> 'admin',query:async()=>{throw Error('password=private PAN=4111111111111111')},now});
 const r=await h(req());assert.equal(r.status,502);assert.ok(!(await r.text()).includes('private'));
});
test('handler rejects malformed, cross-origin, missing auth, arbitrary input and returns normalized data only',async()=>{
 let calls=0;const h=createHandler({read,authenticate:async()=> 'admin',query:async()=>{calls++;return response([row()])},now});
 assert.equal((await h(req(range,{Origin:'https://evil.test'}))).status,403);
 assert.equal((await h(req(range,{Authorization:''}))).status,401);
 assert.equal((await h(req({...range,action:'refund'}))).status,400);
 assert.equal(calls,0);const r=await h(req());assert.equal(r.status,200);assert.equal((await r.json()).transactions.length,1);assert.equal(calls,1);
});
test('real authorization verifies identity before reading its profile role with GET only',async()=>{
 const calls=[];const id='11111111-1111-4111-8111-111111111111';
 const role=await authenticateAdmin('Bearer fixture',()=> 'public-fixture',async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>calls.length===1?{id}:[{role:'admin'}]}});
 assert.equal(role,'admin');assert.equal(calls.length,2);assert.ok(calls.every(c=>c.options.method==='GET'));assert.ok(calls[1].url.endsWith('id=eq.'+id));
});
test('provider permits only two read methods, fixed host, bounded TLS request and no redirects',async()=>{
 const calls=[];const transport=(options,cb)=>{const q=new EventEmitter();q.end=b=>{calls.push({options,body:JSON.parse(b)});const r=Readable.from([JSON.stringify(response([]))]);r.statusCode=200;cb(r)};return q};
 await queryProvider(validateInput(range,now()),read,transport);await queryProvider({action:'lookup',transactionId:'123'},read,transport);
 assert.equal(calls[0].options.hostname,'gateway20.pelecard.biz');assert.equal(calls[0].options.path,'/services/GetTransData');assert.equal(calls[1].options.path,'/services/GetTransDataByTrxId');assert.equal(calls[1].body.DebitTrxId,'123');assert.equal(calls[0].options.rejectUnauthorized,true);assert.ok(calls[0].options.signal);assert.equal(calls[0].body.shvaSuccessOnly,undefined);
 await assert.rejects(()=>queryProvider({action:'refund'},read,transport));assert.equal(calls.length,2);
});
test('provider timeout, HTTP errors and malformed JSON fail safely',async()=>{
 for(const kind of ['timeout','http','json']){
  const transport=(options,cb)=>{const q=new EventEmitter();q.end=()=>{if(kind==='timeout'){const e=Error('private');e.name='TimeoutError';queueMicrotask(()=>q.emit('error',e));return;}const r=Readable.from(['private invalid json']);r.statusCode=kind==='http'?500:200;cb(r)};return q};
  await assert.rejects(()=>queryProvider({action:'lookup',transactionId:'123'},read,transport),e=>['provider_timeout','provider_unavailable'].includes(e.message));
 }
});
