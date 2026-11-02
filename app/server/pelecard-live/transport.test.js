import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {sendLive,ciphers} from './transport.js';
const paymentId='11111111-1111-4111-8111-111111111111';
const credentials={user:'synthetic-user',password:'synthetic-password',terminal:'synthetic-terminal'};
const attempt={amount_minor:3500,currency:'ILS',transaction_id:'txn',confirmation_key:'confirmation'};
test('provider GUID shape matches database without undocumented version restrictions',async()=>{const TransactionId='11111111-1111-7111-1111-111111111111';const t=transport({URL:'https://gateway20.pelecard.biz/PaymentGW?transactionId='+TransactionId,ConfirmationKey:'confirmation'});assert.equal((await sendLive({action:'init',paymentId,credentials,attempt},t.request)).TransactionId,TransactionId);});
test('init does not mistake a short terminal substring in provider correlation for a credential echo',async()=>{const t=transport({URL:'https://gateway20.pelecard.biz/PaymentGW?transactionId='+paymentId,ConfirmationKey:'confirmation1'});await sendLive({action:'init',paymentId,credentials:{...credentials,terminal:'1'},attempt},t.request);});
test('init emits exact database URL representation and rejects keys the database cannot persist',async()=>{const canonical='https://gateway20.pelecard.biz/PaymentGW?transactionId='+paymentId;const equivalent='https://GATEWAY20.pelecard.biz:443/PaymentGW?transactionId='+paymentId.replace('11111111','%311111111');const t=transport({URL:equivalent,ConfirmationKey:'a'.repeat(512)});const result=await sendLive({action:'init',paymentId,credentials,attempt},t.request);assert.equal(result.URL,canonical);for(const ConfirmationKey of ['a'.repeat(513),'invalid:confirmation']){const bad=transport({URL:canonical,ConfirmationKey});await assert.rejects(sendLive({action:'init',paymentId,credentials,attempt},bad.request));}});
test('preserves declined lookup evidence and literal two-digit statuses without approval normalization',async()=>{for(const StatusCode of ['003','00']){const ResultData={ShvaResult:'00',ShvaResultEmv:'003',DebitTotal:'3500',DebitCurrency:'1',JParam:'4',DebitType:'01',ApprovedBy:'3',DebitApproveNumber:'approval-3500'};const t=transport({StatusCode,ResultData:{...ResultData,CardNumber:'private'}});assert.deepEqual(await sendLive({action:'lookup',paymentId,credentials:{...credentials,terminal:'3'},attempt},t.request),{StatusCode,ResultData});}});

test('lookup preserves only sanitized root Tamal observations alongside unchanged payment evidence',async()=>{
 const ResultData={TransactionId:'txn',ShvaResult:'000',DebitTotal:'3500',DebitCurrency:'1'};
 const t=transport({StatusCode:'000',ResultData,TamalData:{InvoiceStatus:' 000',InvoiceNumber:'300413',InvoiceLink:'https://cloud.tamal.co.il/GetDocument.aspx',RawResponse:{card:'private-card'},InvoiceError:'private-error'},PayperData:{InvoiceNumber:'ignored'}});
 const result=await sendLive({action:'lookup',paymentId,credentials,attempt},t.request);
 assert.deepEqual(result.ResultData,ResultData);assert.equal(result.StatusCode,'000');
 assert.equal(result.DocumentMetadata.invoiceStatus,' 000');assert.equal(result.DocumentMetadata.state,'unverified');assert.equal(result.DocumentMetadata.invoiceNumber,'300413');
 assert.equal(result.DocumentMetadata.errorPresent,true);assert.equal(result.DocumentMetadata.errorCode,null);assert.equal(result.DocumentMetadata.rawResponsePresent,true);
 assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!Object.hasOwn(result,'TamalData'));assert.ok(!Object.hasOwn(result,'PayperData'));assert.equal(t.calls.length,1);
});

test('malformed or credential-bearing metadata cannot change payment lookup outcome',async()=>{
 for(const TamalData of [null,[],{InvoiceStatus:'synthetic-password'},{InvoiceLink:'https://cloud.tamal.co.il/GetDocument.aspx?x=synthetic%2Dpassword'},{InvoiceNumber:'synthetic-password'}]){
  const t=transport({StatusCode:'000',ResultData:{ShvaResult:'000',DebitTotal:'3500'},TamalData});
  const result=await sendLive({action:'lookup',paymentId,credentials,attempt},t.request);
  assert.deepEqual(result.ResultData,{ShvaResult:'000',DebitTotal:'3500'});assert.equal(result.DocumentMetadata.metadataInvalid,true);assert.ok(!JSON.stringify(result).includes('synthetic-password'));assert.equal(t.calls.length,1);
 }
});

test('document metadata never adds fields to init or validate output',async()=>{
 const t=transport({URL:'https://gateway20.pelecard.biz/PaymentGW?transactionId='+paymentId,ConfirmationKey:'confirmation',TamalData:{InvoiceNumber:'123'}});
 assert.ok(!Object.hasOwn(await sendLive({action:'init',paymentId,credentials,attempt},t.request),'DocumentMetadata'));
});

test('padded document status cannot echo short numeric credentials',async()=>{
 for(const [field,secret] of [['password','12345'],['user','23456'],['terminal','7654321']]){
  const t=transport({StatusCode:'000',ResultData:{ShvaResult:'000',DebitTotal:'3500'},TamalData:{InvoiceStatus:' '+secret+' '}});
  const result=await sendLive({action:'lookup',paymentId,credentials:{...credentials,[field]:secret},attempt},t.request);
  assert.equal(result.DocumentMetadata.invoiceStatus,null);assert.equal(result.DocumentMetadata.metadataInvalid,true);
  assert.deepEqual(result.ResultData,{ShvaResult:'000',DebitTotal:'3500'});
 }
});
test('rejects arbitrary strings in lookup numeric evidence fields',async()=>{for(const field of ['ShvaResult','ShvaResultEmv','DebitTotal','DebitCurrency','JParam','DebitType','ApprovedBy']){const t=transport({StatusCode:'003',ResultData:{[field]:'private-provider-message'}});await assert.rejects(sendLive({action:'lookup',paymentId,credentials,attempt},t.request));}});
test('normalizes init ID from hosted URL and rejects mismatched IDs',async()=>{const URL='https://gateway20.pelecard.biz/PaymentGW?transactionId='+paymentId;const t=transport({URL,ConfirmationKey:'confirmation'});assert.deepEqual(await sendLive({action:'init',paymentId,credentials,attempt},t.request),{URL,ConfirmationKey:'confirmation',TransactionId:paymentId});const bad=transport({URL,ConfirmationKey:'confirmation',TransactionId:'22222222-2222-4222-8222-222222222222'});await assert.rejects(sendLive({action:'init',paymentId,credentials,attempt},bad.request));});
function transport(result,status=200){const calls=[];return {calls,request:(options,cb)=>{const req=new EventEmitter();req.end=payload=>{calls.push({options,payload:JSON.parse(payload)});const response=Readable.from([Buffer.from(typeof result==='string'?result:JSON.stringify(result))]);response.statusCode=status;queueMicrotask(()=>cb(response));};return req;}};}
test('preserves safe lookup rejection status with null data, rejects secret echoes',async()=>{const rejected=transport({StatusCode:'003',ResultData:null,ErrorMessage:'private'});assert.deepEqual(await sendLive({action:'lookup',paymentId,credentials,attempt},rejected.request),{StatusCode:'003',ResultData:null});for(const response of [{StatusCode:'synthetic-password',ResultData:{}},{StatusCode:'000',ResultData:{ConfirmationKey:'synthetic-password'}}]){const t=transport(response);await assert.rejects(sendLive({action:'lookup',paymentId,credentials,attempt},t.request));}});
test('fixed gateway20 paths, strict TLS and immutable payloads for all operations',async()=>{for(const action of ['init','lookup','validate']){const t=transport(action==='init'?{URL:'https://gateway20.pelecard.biz/PaymentGW?transactionId='+paymentId,ConfirmationKey:'confirmation',TransactionId:paymentId,StatusCode:'000'}:action==='lookup'?{StatusCode:'000',ResultData:{TransactionId:'txn',CardNumber:'secret-card'}}:1);const result=await sendLive({action,paymentId,credentials,attempt},t.request);assert.equal(t.calls.length,1);const {options,payload}=t.calls[0];assert.equal(options.hostname,'gateway20.pelecard.biz');assert.equal(options.path,'/PaymentGW/'+({init:'init',lookup:'GetTransaction',validate:'ValidateByUniqueKey'}[action]));assert.equal(options.minVersion,'TLSv1.2');assert.equal(options.rejectUnauthorized,true);assert.equal(options.ciphers,ciphers);assert.equal(typeof options.checkServerIdentity,'function');assert.ok(!JSON.stringify(result).includes('secret-card'));if(action==='init'){assert.equal(payload.Total,'3500');assert.equal(payload.Currency,'1');assert.equal(payload.UserKey,paymentId);assert.equal(payload.resultDataKeyName,'result');assert.equal(new URL(payload.ServerSideGoodFeedbackURL).searchParams.get('paymentId'),paymentId);}if(action==='lookup')assert.equal(payload.TransactionId,'txn');if(action==='validate')assert.deepEqual(payload,{ConfirmationKey:'confirmation',UniqueKey:paymentId,TotalX100:'3500'});}});
test('rejects redirect, bad URL, credential echoes, malformed and oversized responses without retry',async()=>{for(const [body,status] of [[{},302],['not json',200],['x'.repeat(65537),200],[{URL:'https://evil.example',ConfirmationKey:'confirmation'},200],[{URL:'https://gateway20.pelecard.biz/?x=synthetic-password',ConfirmationKey:'confirmation'},200]]){const t=transport(body,status);await assert.rejects(sendLive({action:'init',paymentId,credentials,attempt},t.request));assert.equal(t.calls.length,1);}});
test('validate accepts only numeric 0/1 and rejects nonallowlisted actions',async()=>{for(const value of ['"1"','true','{}']){const t=transport(value);await assert.rejects(sendLive({action:'validate',paymentId,credentials,attempt},t.request));}const t=transport(1);await assert.rejects(async()=>sendLive({action:'refund',paymentId,credentials,attempt},t.request));assert.equal(t.calls.length,0);});
