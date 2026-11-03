// Disposable in-memory PostgreSQL; no production connection or credentials.
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve,join,dirname} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
const modulePath=process.env.PAYPER_PGLITE_MODULE||
  resolve(root,'../../.tmp/payment-db/node_modules/@electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const extRoot=join(dirname(modulePath),'contrib');
const {uuid_ossp}=await import(pathToFileURL(join(extRoot,'uuid_ossp.js')).href);
const {pg_trgm}=await import(pathToFileURL(join(extRoot,'pg_trgm.js')).href);
const db=new PGlite({extensions:{uuid_ossp,pg_trgm}});
const read=path=>readFile(join(root,path),'utf8');
let stage='fixture';
try{
  await db.exec(await read('scripts/payments/fixture.sql'));
  await db.exec(await read('scripts/payments/assertions.sql'));
  for(const name of (await readdir(join(root,'supabase/migrations')))
    .filter(name=>name.endsWith('.sql')).sort()){
    if(process.env.SKIP_RECOVERY_MIGRATION==='1'&&name==='202611030001_pelecard_pending_recovery.sql')continue;
    stage=name;await db.exec(await read('supabase/migrations/'+name));
  }
  const one=async sql=>(await db.query(sql)).rows[0];
  const actor='93000000-0000-4000-8000-000000000001';
  const cashier='93000000-0000-4000-8000-000000000002';
  stage='disabled controls and access';
  assert.deepEqual(await one('SELECT enabled,cutoff_utc FROM public.pelecard_pending_recovery_control'),
    {enabled:false,cutoff_utc:null});
  await assert.rejects(()=>db.query('SELECT * FROM public.claim_pelecard_pending_recovery()'),
    /service_role_required/);
  await db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
  assert.equal((await db.query('SELECT * FROM public.claim_pelecard_pending_recovery()')).rows.length,0);
  assert.equal((await one(`SELECT has_function_privilege('authenticated',
    'public.claim_pelecard_pending_recovery()','EXECUTE') AS allowed`)).allowed,false);
  assert.equal((await one(`SELECT has_table_privilege('authenticated',
    'public.pelecard_pending_recovery_jobs','SELECT') AS allowed`)).allowed,false);
  await db.exec(`INSERT INTO auth.users(id,email) VALUES
    ('${actor}','recovery-admin@example.test'),('${cashier}','recovery-cashier@example.test');
    SELECT set_config('request.jwt.claim.role','service_role',false);
    UPDATE public.profiles SET role='admin' WHERE id='${actor}';
    UPDATE public.profiles SET role='cashier' WHERE id='${cashier}';
    INSERT INTO public.products(id,name,price,status) VALUES
    ('93000000-0000-4000-8000-000000000003','Synthetic item',3,'פעיל');`);
  const pos=async (user,key,transaction)=>{
    const payment=(await one(`SELECT public.reserve_pos_pelecard('${user}','${key}',
      '[{"kind":"product","id":"93000000-0000-4000-8000-000000000003","qty":1}]',
      NULL,'{"kind":"person","name":"Synthetic Customer","identity":"000000018","email":"test@example.test"}') AS value`)).value.paymentId;
    await db.query(`SELECT public.claim_pos_pelecard_init('${payment}')`);
    await db.query(`SELECT public.persist_pos_pelecard_session('${payment}','${transaction}',
      'synthetic-key','https://gateway20.pelecard.biz/PaymentGW?transactionId=${transaction}')`);
    return payment;
  };
  const old=await pos(actor,'93000000-0000-4000-8000-000000000004',
    '93000000-0000-4000-8000-000000000005');
  stage='immutable future cutoff';
  await assert.rejects(()=>db.query(`SELECT public.start_pelecard_pending_recovery('${cashier}')`),
    /recovery_admin_required/);
  const cutoff=(await one(`SELECT public.start_pelecard_pending_recovery('${actor}') AS value`)).value;
  assert.ok(cutoff);
  assert.equal((await db.query('SELECT * FROM public.claim_pelecard_pending_recovery()')).rows.length,0);
  await db.query(`UPDATE public.payper_dispatch_control
    SET activation_cutoff_utc=statement_timestamp() WHERE singleton`);
  const fresh=await pos(cashier,'93000000-0000-4000-8000-000000000006',
    '93000000-0000-4000-8000-000000000007');
  const claimed=await one('SELECT * FROM public.claim_pelecard_pending_recovery()');
  assert.equal(claimed.payment_id,fresh);assert.equal(claimed.source,'pos');
  assert.equal((await db.query('SELECT * FROM public.claim_pelecard_pending_recovery()')).rows.length,0);
  await db.query(`UPDATE public.pelecard_pending_recovery_jobs
    SET lease_until=clock_timestamp()-interval '1 second' WHERE payment_id='${fresh}'`);
  const reclaimed=await one('SELECT * FROM public.claim_pelecard_pending_recovery()');
  assert.equal(reclaimed.payment_id,fresh);
  assert.notEqual(reclaimed.claim_token,claimed.claim_token);
  await assert.rejects(()=>db.query(`SELECT public.complete_pelecard_pending_recovery('${fresh}',
    '${claimed.claim_token}','pending','425','173')`),/recovery_claim_mismatch/);
  stage='pending and alert';
  await db.query(`SELECT public.complete_pelecard_pending_recovery('${fresh}',
    '${reclaimed.claim_token}','provider_unavailable',NULL,NULL)`);
  assert.deepEqual(await one(`SELECT state,last_reason FROM public.pelecard_pending_recovery_jobs
    WHERE payment_id='${fresh}'`),{state:'attention',last_reason:'provider_unavailable'});
  await db.query(`SELECT set_config('request.jwt.claim.role','authenticated',false),
    set_config('request.jwt.claim.sub','${actor}',false)`);
  assert.equal((await db.query('SELECT * FROM public.list_pelecard_pending_alerts()')).rows[0].payment_id,fresh);
  await db.query(`SELECT set_config('request.jwt.claim.sub','${cashier}',false)`);
  await assert.rejects(()=>db.query('SELECT * FROM public.list_pelecard_pending_alerts()'),
    /recovery_admin_required/);
  await db.query(`SELECT set_config('request.jwt.claim.role','service_role',false)`);
  await assert.rejects(()=>db.query(`SELECT public.complete_pelecard_pending_recovery('${fresh}',
    '${claimed.claim_token}','verified','000','000')`),/recovery_claim_mismatch/);
  await assert.rejects(()=>db.query(`UPDATE public.pelecard_pending_recovery_control
    SET cutoff_utc=now()-interval '1 day'`),/recovery_cutoff_immutable/);
  stage='verified existing POS and no duplicate sale';
  await db.query(`SELECT public.observe_pos_pelecard('${fresh}','usable','000','000',true)`);
  await db.query(`SELECT public.finalize_pos_pelecard('${fresh}','synthetic-approval')`);
  await db.query(`SELECT public.finalize_pos_pelecard('${fresh}','synthetic-approval')`);
  assert.equal((await one(`SELECT count(*)::integer AS n FROM public.sales
    WHERE payment_transaction_id='${fresh}'`)).n,1);
  assert.equal((await one(`SELECT state FROM public.payper_document_ledger
    WHERE payment_id='${fresh}'`)).state,'eligible');
  assert.equal((await db.query('SELECT * FROM public.claim_pelecard_pending_recovery()')).rows.length,0);
  stage='Orders candidate';
  const order='93000000-0000-4000-8000-000000000008';
  await db.exec(`INSERT INTO public.orders(id,client_name,client_phone,activity_date,num_participants,total_price)
    VALUES('${order}','Synthetic Buyer','0000000000',CURRENT_DATE,1,3);`);
  const orderPayment=(await one(`SELECT public.reserve_pelecard_live_order('${order}',
    '${actor}',300,NULL) AS value`)).value.id;
  await db.query(`SELECT * FROM public.claim_pelecard_live_init('${orderPayment}')`);
  await db.query(`SELECT public.persist_pelecard_live_adapter_session('${orderPayment}',
    '93000000-0000-4000-8000-000000000009','synthetic-key',
    'https://gateway20.pelecard.biz/PaymentGW?transactionId=93000000-0000-4000-8000-000000000009')`);
  const orderClaim=await one('SELECT * FROM public.claim_pelecard_pending_recovery()');
  assert.equal(orderClaim.payment_id,orderPayment);assert.equal(orderClaim.source,'order');
  await db.query(`SELECT public.observe_pelecard_live_attempt('${orderPayment}',
    'usable','000','000',true)`);
  await db.query(`SELECT public.finalize_pelecard_live('${orderPayment}',
    '93000000-0000-4000-8000-000000000009','synthetic-approval','000',3,'ILS')`);
  await db.query(`SELECT public.complete_pelecard_pending_recovery('${orderPayment}',
    '${orderClaim.claim_token}','pending','425','173')`);
  assert.equal((await one(`SELECT state FROM public.pelecard_pending_recovery_jobs
    WHERE payment_id='${orderPayment}'`)).state,'verified');
  assert.equal((await one(`SELECT count(*)::integer AS n FROM public.sales
    WHERE payment_transaction_id='${orderPayment}'`)).n,1);
  assert.equal((await one(`SELECT count(*)::integer AS n FROM public.payper_document_ledger
    WHERE payment_id='${orderPayment}'`)).n,1);
  stage='declined result remains financially unconfirmed';
  const declined=await pos(cashier,'93000000-0000-4000-8000-000000000010',
    '93000000-0000-4000-8000-000000000011');
  const declineClaim=await one('SELECT * FROM public.claim_pelecard_pending_recovery()');
  assert.equal(declineClaim.payment_id,declined);
  await db.query(`SELECT public.complete_pelecard_pending_recovery('${declined}',
    '${declineClaim.claim_token}','declined','000','005')`);
  assert.deepEqual(await one(`SELECT state,last_reason FROM public.pelecard_pending_recovery_jobs
    WHERE payment_id='${declined}'`),{state:'attention',last_reason:'provider_declined'});
  assert.equal((await one(`SELECT status FROM public.payment_transactions WHERE id='${declined}'`)).status,
    'pending_provider');
  assert.equal((await one(`SELECT count(*)::integer AS n FROM public.sales
    WHERE payment_transaction_id='${declined}'`)).n,0);
  await db.query(`SELECT public.stop_pelecard_pending_recovery('${actor}')`);
  assert.equal((await one('SELECT enabled FROM public.pelecard_pending_recovery_control')).enabled,false);
  assert.equal((await db.query('SELECT * FROM public.claim_pelecard_pending_recovery()')).rows.length,0);
  console.log('PASS pending recovery SQL: disabled, future cutoff, POS/Orders, lease, alert, idempotency, stop');
}catch(error){console.error('FAIL stage:',stage);throw error;}
finally{await db.close();}
