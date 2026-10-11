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
  await db.exec(read('supabase/migrations/'+name));
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
}catch(error){console.error('FAIL',error.message,error.where||'');process.exitCode=1;}finally{await db.close();}
