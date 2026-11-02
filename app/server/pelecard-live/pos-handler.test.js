import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {handlePosLive} from './handler.js';
const id='11111111-1111-4111-8111-111111111111', now=1700000000000, key='a'.repeat(64);
function setup(action='init',gate='true'){
 const env={PELECARD_LIVE_ADAPTER_MODE:'live',PELECARD_POS_PAYMENTS_ENABLED:gate,PELECARD_LIVE_ADAPTER_AUTH_KEY:key,PELECARD_LIVE_USER:'user',PELECARD_LIVE_PASSWORD:'password',PELECARD_LIVE_TERMINAL:'terminal'};
 const calls=[];
 const deps={read:name=>env[name],now:()=>now,log:()=>{},claim:async()=>{calls.push('claim');return {amount_minor:100,currency:'ILS'};},getAttempt:async()=>{calls.push('read');return {payment_id:id,amount_minor:100,currency:'ILS',transaction_id:'txn',confirmation_key:'key'};},send:async()=>{calls.push('send');return {StatusCode:'000'};},persist:async()=>{calls.push('persist');}};
 const request=(patch={})=>{const raw=JSON.stringify({action,paymentId:id,issuedAt:now,...patch});return new Request('https://app.example/api/pelecard-pos',{method:'POST',headers:{'content-type':'application/json','x-pelecard-signature':createHmac('sha256',key).update('POST\n/api/pelecard-pos\n'+raw).digest('hex')},body:raw});};
 return {deps,calls,request};
}
test('one agorot-priced server intent is claimed before one gateway init',async()=>{const s=setup();assert.equal((await handlePosLive(s.request(),s.deps)).status,200);assert.deepEqual(s.calls,['claim','send','persist']);});
test('closed POS gate blocks init but permits reconciliation lookup',async()=>{const s=setup('init','false');assert.equal((await handlePosLive(s.request(),s.deps)).status,503);assert.deepEqual(s.calls,[]);const t=setup('lookup','false');assert.equal((await handlePosLive(t.request(),t.deps)).status,200);assert.deepEqual(t.calls,['read','send']);});
test('refund, browser amount and invalid signature cannot reach provider',async()=>{for(const patch of [{action:'refund'},{amountMinor:1}]){const s=setup();assert.equal((await handlePosLive(s.request(patch),s.deps)).status,400);assert.deepEqual(s.calls,[]);}});
test('init ambiguity never redispatches',async()=>{const s=setup();s.deps.persist=async()=>{throw Error('uncertain persistence')};assert.equal((await handlePosLive(s.request(),s.deps)).status,502);assert.deepEqual(s.calls,['claim','send']);});
