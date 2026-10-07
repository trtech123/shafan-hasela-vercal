import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {PGlite} from '../../.tmp/payment-db/node_modules/@electric-sql/pglite/dist/index.js';
import {uuid_ossp} from '../../.tmp/payment-db/node_modules/@electric-sql/pglite/dist/contrib/uuid_ossp.js';
import {pg_trgm} from '../../.tmp/payment-db/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js';
const w=path.resolve(import.meta.dirname,'../..'),db=new PGlite({extensions:{uuid_ossp,pg_trgm}});
try{for(const p of ['scripts/payments/fixture.sql','scripts/payments/assertions.sql'])await db.exec(fs.readFileSync(w+'/'+p,'utf8'));
const applied=[];for(const p of fs.readdirSync(w+'/supabase/migrations').filter(x=>x.endsWith('.sql')).sort()){if(p==='046_quotation_lifecycle.sql')await db.exec(`INSERT INTO public.quotes(id,client_name,client_phone,event_date,num_participants,selected_activities,total_price,discount,final_price) VALUES ('96000000-0000-4000-8000-000000000090','Pre-migration legacy','0500000000','2026-11-01',10,'[{"activity_name":"Historical legacy","price_per_person":5}]',50,0,50)`);await db.exec(fs.readFileSync(w+'/supabase/migrations/'+p,'utf8'));applied.push(p);}
for(const p of ['customer_vouchers.sql','order_form_customer.sql','quotation_lifecycle.sql','order_confirmation_delivery.sql','delivery_acceptance.sql']){const s=fs.readFileSync(w+'/supabase/tests/'+p,'utf8');await db.exec(s);console.log('PASS '+p);}
console.log('PASS '+applied.length+' migrations in disposable local PGlite; no network/provider calls');}catch(e){console.error('FAIL',e.message,e.where||'');process.exitCode=1;}finally{await db.close();}
