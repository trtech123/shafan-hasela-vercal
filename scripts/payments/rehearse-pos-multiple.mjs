// Disposable PGlite rehearsal. No production connection or real provider calls.
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve,join,dirname} from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../..');
const modulePath=process.env.PAYPER_PGLITE_MODULE||resolve(root,'../../.tmp/payment-db/node_modules/@electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const extRoot=join(dirname(modulePath),'contrib');
const {uuid_ossp}=await import(pathToFileURL(join(extRoot,'uuid_ossp.js')).href);
const {pg_trgm}=await import(pathToFileURL(join(extRoot,'pg_trgm.js')).href);
const db=new PGlite({extensions:{uuid_ossp,pg_trgm}});
const read=path=>readFile(join(root,path),'utf8');
const migration='202611030004_pos_checkout_scope.sql';
const admin='95000000-0000-4000-8000-000000000001';
const cashier='95000000-0000-4000-8000-000000000002';
const product='95000000-0000-4000-8000-000000000003';
const request=n=>`95000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const lines=JSON.stringify([{kind:'product',id:product,qty:1}]);
const billing=JSON.stringify({kind:'person',name:'Synthetic Customer',identity:'000000018',email:'synthetic@example.test'});
const reserve=async(actor,key)=>{
  const sql=`select public.reserve_pos_pelecard('${actor}','${key}','${lines}'::jsonb,null,'${billing}'::jsonb) as result`;
  return (await db.query(sql)).rows[0].result;
};
try{
  await db.exec(await read('scripts/payments/fixture.sql'));
  await db.exec(await read('scripts/payments/assertions.sql'));
  for(const name of (await readdir(join(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')&&n<migration).sort())
    await db.exec(await read('supabase/migrations/'+name));
  if(process.env.POS_REHEARSAL_OLD!=='1')await db.exec(await read('supabase/migrations/'+migration));
  if(process.env.POS_REHEARSAL_OLD!=='1'){
    const suite=(await read('supabase/tests/pos_pelecard.sql')).replace(
      'CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;',
      '-- Extension-compatible assertion harness loaded above.');
    await db.exec(suite);
    console.log('PASS: 37 existing POS SQL assertions on disposable PostgreSQL');
  }
  await db.exec(`insert into auth.users(id,email) values('${admin}','pos-multi-admin@example.test'),('${cashier}','pos-multi-cashier@example.test');
    select set_config('request.jwt.claim.role','service_role',false);
    update public.profiles set role='admin' where id='${admin}';
    update public.profiles set role='cashier' where id='${cashier}';
    insert into public.products(id,name,price,status) values('${product}','Synthetic sweets',3.00,'פעיל');`);
  const first=await reserve(cashier,request(10));
  assert.equal(first.amountMinor,300);
  await db.query(`select amount_minor from public.claim_pos_pelecard_init('${first.paymentId}')`);
  const session='95000000-0000-4000-8000-000000000020';
  await db.query(`select public.persist_pos_pelecard_session('${first.paymentId}','${session}','synthetic-key',
    'https://gateway20.pelecard.biz/PaymentGW?transactionId=${session}')`);
  assert.equal((await db.query(`select status from public.payment_transactions where id='${first.paymentId}'`)).rows[0].status,'pending_provider');
  await db.query('update public.payper_dispatch_control set activation_cutoff_utc=clock_timestamp() where singleton');
  const finalize=async(paymentId,n)=>{
    const providerId=`96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    await db.query(`select amount_minor from public.claim_pos_pelecard_init('${paymentId}')`);
    await db.query(`select public.persist_pos_pelecard_session('${paymentId}','${providerId}','synthetic-key-${n}',
      'https://gateway20.pelecard.biz/PaymentGW?transactionId=${providerId}')`);
    await db.query(`select public.observe_pos_pelecard('${paymentId}','usable','000','000',true)`);
    await db.query(`select public.finalize_pos_pelecard('${paymentId}','approval-${n}')`);
    await db.query(`select public.finalize_pos_pelecard('${paymentId}','approval-${n}')`);
    assert.equal((await db.query(`select count(*)::integer as n from public.sales where payment_transaction_id='${paymentId}'`)).rows[0].n,1);
    assert.equal((await db.query(`select state from public.payper_document_ledger where payment_id='${paymentId}'`)).rows[0].state,'eligible');
  };
  const cashierPayments=[first.paymentId];
  for(let n=11;n<=15;n++){
    const result=await reserve(cashier,request(n));
    assert.equal(result.amountMinor,300);
    assert.equal(result.created,true);
    assert.ok(!cashierPayments.includes(result.paymentId));
    cashierPayments.push(result.paymentId);
    await finalize(result.paymentId,n);
  }
  assert.equal((await reserve(cashier,request(15))).paymentId,cashierPayments.at(-1));
  const adminPayments=[];
  for(let n=30;n<=32;n++){
    const result=await reserve(admin,request(n));adminPayments.push(result.paymentId);
    await finalize(result.paymentId,n);
  }
  assert.equal(new Set([...cashierPayments,...adminPayments]).size,9);
  const parallel=await Promise.all([reserve(admin,request(40)),reserve(admin,request(40))]);
  assert.equal(parallel[0].paymentId,parallel[1].paymentId);
  assert.equal((await db.query(`select count(*)::integer as n from public.pos_pelecard_intents where request_key='${request(40)}'`)).rows[0].n,1);
  const independent=await Promise.all([reserve(cashier,request(50)),reserve(cashier,request(51))]);
  assert.notEqual(independent[0].paymentId,independent[1].paymentId);
  assert.equal((await db.query(`select count(*)::integer as n from public.pos_pelecard_intents where request_key in ('${request(50)}','${request(51)}')`)).rows[0].n,2);
  assert.equal((await db.query(`select count(*)::integer as n from public.sales where payment_transaction_id=any(array[${cashierPayments.map(id=>`'${id}'::uuid`).join(',')}])`)).rows[0].n,5);
  assert.equal((await db.query(`select count(*)::integer as n from public.payper_document_ledger where payment_id=any(array[${cashierPayments.map(id=>`'${id}'::uuid`).join(',')}])`)).rows[0].n,5);
  assert.equal((await db.query(`select status from public.payment_transactions where id='${first.paymentId}'`)).rows[0].status,'pending_provider');
  console.log('PASS: five verified cashier sales, three verified admin sales, distinct same-amount payments, old pending preserved, one sale and Payper obligation per payment, concurrent same-key and distinct-key reservations');
}finally{await db.close();}
