import assert from 'node:assert/strict';
﻿import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'../..');
let dependencies=root;
while(!fs.existsSync(path.join(dependencies,'.tmp/payment-db/node_modules/@electric-sql/pglite/dist/index.js'))){const parent=path.dirname(dependencies);if(parent===dependencies)throw Error('local_pglite_required');dependencies=parent;}
const modulePath=path.join(dependencies,'.tmp/payment-db/node_modules/@electric-sql/pglite/dist');
const {PGlite}=await import(pathToFileURL(path.join(modulePath,'index.js')));
const {uuid_ossp}=await import(pathToFileURL(path.join(modulePath,'contrib/uuid_ossp.js')));
const {pg_trgm}=await import(pathToFileURL(path.join(modulePath,'contrib/pg_trgm.js')));
const db=new PGlite({extensions:{uuid_ossp,pg_trgm}});
const read=name=>fs.readFileSync(path.join(root,name),'utf8').replace(/^\uFEFF/,'');
try{
 for(const name of ['scripts/payments/fixture.sql','scripts/payments/assertions.sql']) await db.exec(read(name));
 for(const name of fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()){
  if(process.argv.includes('--red')&&name.includes('order_confirmation_signatures'))continue;
  let legacy;
  if(name==='202610110002_order_confirmation_signer_id.sql') {
   await db.exec(read('supabase/tests/order_confirmation_signer_id_before.sql'));
   legacy=(await db.query("SELECT to_jsonb(r) AS evidence FROM public.order_confirmation_revisions r WHERE id='98200000-0000-4000-8000-000000000010'")).rows[0].evidence;
  }
  if(name==='202610110003_order_confirmation_customer_readiness.sql') await db.exec(`
   SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
   DO $$ DECLARE old public.order_confirmation_revisions; fresh jsonb; BEGIN
    SELECT * INTO old FROM public.order_confirmation_revisions WHERE id='98200000-0000-4000-8000-000000000010';
    fresh=public.order_signature_action('create',jsonb_build_object('actorId',old.created_by,'orderId',old.order_id,'tokenHash',repeat('ab',32),'days',7,'text','{"ORDER_TERMS":["original"]}'::jsonb,'renderVersion','2','acceptanceVersion','1','acceptanceText','Synthetic existing pending before cleanup migration'));
    PERFORM public.order_signature_action('ready',jsonb_build_object('actorId',old.created_by,'revisionId',fresh->>'id','revisionHash',repeat('b',64),'unsignedHash',repeat('c',64)));
   END $$;
  `);
  const beforeCleanup=name==='202610110003_order_confirmation_customer_readiness.sql' ? (await db.query("SELECT to_jsonb(r) AS evidence FROM public.order_confirmation_revisions r ORDER BY id")).rows : null;
  await db.exec(read('supabase/migrations/'+name));
  if(beforeCleanup)assert.deepEqual((await db.query("SELECT to_jsonb(r) AS evidence FROM public.order_confirmation_revisions r ORDER BY id")).rows,beforeCleanup,'cleanup must preserve every existing revision exactly');
  if(beforeCleanup)await db.exec(`
   BEGIN;
   DO $$ DECLARE input jsonb; r jsonb; BEGIN
    input=jsonb_build_object('tokenHash',repeat('ab',32),'requestId','98200000-0000-4000-8000-000000000013','fullName','Pending Signer','strokes','[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb,'accepted',true);
    r=public.order_signature_action('claim',input);
    r=public.order_signature_action('finish',input||jsonb_build_object('signedHash',repeat('d',64)));
    IF r->>'status'<>'signed' OR r->>'signer_id' IS NOT NULL THEN RAISE EXCEPTION 'preexisting pending no-ID acceptance broken'; END IF;
    IF public.order_signature_action('claim',input)<>r THEN RAISE EXCEPTION 'signed no-ID replay changed evidence'; END IF;
   END $$;
   ROLLBACK;
  `);
  if(legacy) {
   const after=(await db.query("SELECT to_jsonb(r)-'signer_id' AS evidence,signer_id FROM public.order_confirmation_revisions r WHERE id='98200000-0000-4000-8000-000000000010'")).rows[0];
   assert.deepEqual(after.evidence,legacy);assert.equal(after.signer_id,null);
   await db.exec(read('supabase/tests/order_confirmation_signer_id_after.sql'));
   console.log('PASS additive signer ID migration preserves legacy signed evidence exactly');
  }
 }
 for(const name of ['order_confirmation_signatures.sql','customer_vouchers.sql','order_confirmation_delivery.sql','delivery_acceptance.sql']){
  await db.exec(read('supabase/tests/'+name));console.log('PASS '+name);
 }
 console.log('PASS canonical migrations and signature/HAKAFA/delivery suites; disposable database only');
}catch(error){console.error('FAIL',error.message,error.where||'',error.position||'',error.internalQuery||'');process.exitCode=1;}finally{await db.close();}
