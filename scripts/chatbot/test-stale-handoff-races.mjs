// Real multi-session PostgreSQL races on loopback only. External disposable binaries/deps.
// Usage: node scripts/chatbot/test-stale-handoff-races.mjs <external npm install directory>
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const dep=resolve(process.argv[2]);
const require=createRequire(join(dep,'package.json'));
const {Client}=require('pg');
const bin=join(dep,'node_modules/@embedded-postgres/windows-x64/native/bin');
const dir=await mkdtemp(join(tmpdir(),'chatbot-stale-race-'));
const run=(exe,args)=>execFileSync(join(bin,exe+'.exe'),args,{windowsHide:true,stdio:'ignore',timeout:60000});
const clients=[];let started=false;
const read=f=>readFile(new URL('../../'+f,import.meta.url),'utf8');
try {
 run('initdb',['-D',dir+'/data','-U','postgres','-A','trust','--encoding=UTF8','--locale=C']);
 run('pg_ctl',['-D',dir+'/data','-l',dir+'/postgres.log','-o','-h 127.0.0.1 -p 55439','-w','start']);started=true;
 const connect=async()=>{const c=new Client({host:'127.0.0.1',port:55439,user:'postgres',database:'postgres'});await c.connect();clients.push(c);await c.query("SET lock_timeout='5s'; SET statement_timeout='10s'");return c;};
 const db=await connect(),a=await connect(),b=await connect();
 await db.query(await read('scripts/payments/fixture.sql'));
 for(const name of (await readdir(new URL('../../supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.query(await read('supabase/migrations/'+name));
 const admin='96000000-0000-4000-8000-000000000077';
 await db.query("INSERT INTO auth.users(id) VALUES($1)",[admin]);
 await db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
 await db.query("UPDATE profiles SET role='admin' WHERE id=$1",[admin]);
 for(const c of [a,b])await c.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:admin})]);
 async function fixture(){
  const c=(await db.query("INSERT INTO bot_contacts(channel,external_contact_id,verification_source,verified_at) VALUES('whatsapp',gen_random_uuid()::text,'meta_whatsapp_signed_webhook',now()) RETURNING id")).rows[0];
  const v=(await db.query("INSERT INTO bot_conversations(contact_id,channel,thread_id,content_version,status) VALUES($1,'whatsapp',gen_random_uuid()::text,'test','awaiting_human') RETURNING id",[c.id])).rows[0];
  const e=(await db.query("INSERT INTO bot_channel_events(channel,provider_event_id,event_kind,payload_digest,occurred_at) VALUES('whatsapp',gen_random_uuid()::text,'message',repeat('a',64),now()) RETURNING id")).rows[0];
  await db.query("INSERT INTO bot_messages(conversation_id,trigger_event_id,channel,direction,message_kind,occurred_at) VALUES($1,$2,'whatsapp','inbound','text',now())",[v.id,e.id]);
  const h=(await db.query("INSERT INTO bot_handoffs(conversation_id,reason,summary,created_at) VALUES($1,'unknown_question','synthetic race',now()-interval '1 day') RETURNING id",[v.id])).rows[0];
  return {v:v.id,e:e.id,h:h.id};
 }
 const release=(c,f)=>c.query("SELECT * FROM release_stale_bot_handoff($1,$2,'reset menu')",[f.v,f.e]);
 const claim=(c,f)=>c.query('SELECT claim_bot_handoff($1) ok',[f.h]);
 async function blocked(pid){for(let i=0;i<100;i++){const r=await db.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid]);if(r.rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}throw Error('expected_lock_wait_not_observed');}
 const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
 // Operator owns the row first. Expiry must wait and then preserve ownership.
 let f=await fixture();await a.query('BEGIN');assert.equal((await claim(a,f)).rows[0].ok,true);
 let pending=release(b,f);await blocked(pid);await a.query('COMMIT');assert.equal((await pending).rows.length,0);
 assert.equal((await db.query('SELECT status FROM bot_conversations WHERE id=$1',[f.v])).rows[0].status,'human_active');
 // Expiry owns the row first. Claim must wait and then refuse the closed handoff.
 f=await fixture();await a.query('BEGIN');assert.equal((await release(a,f)).rows.length,1);
 pending=claim(b,f);await blocked(pid);await a.query('COMMIT');assert.equal((await pending).rows[0].ok,false);
 // Two inbound processors race for the same stale handoff: one reset intent only.
 f=await fixture();await a.query('BEGIN');assert.equal((await release(a,f)).rows.length,1);
 pending=release(b,f);await blocked(pid);await a.query('COMMIT');assert.equal((await pending).rows.length,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM bot_messages WHERE conversation_id=$1 AND direction='outbound'",[f.v])).rows[0].n,1);
 console.log('PASS 3 real PostgreSQL multi-session races: claim wins, expiry wins, duplicate expiry. Lock waits observed; no double owner/reset.');
} finally {
 for(const c of clients)await c.end();
 if(started)run('pg_ctl',['-D',dir+'/data','-m','fast','-w','stop']);
}
