// Disposable in-memory PostgreSQL; never uses production credentials or sends messages.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(resolve(process.argv[2],'package.json'));
const {PGlite}=require('@electric-sql/pglite');
const {uuid_ossp}=require('@electric-sql/pglite/contrib/uuid_ossp');
const {pg_trgm}=require('@electric-sql/pglite/contrib/pg_trgm');
const db=new PGlite({extensions:{uuid_ossp,pg_trgm}});
const read=f=>readFile(new URL('../../'+f,import.meta.url),'utf8');
await db.exec(await read('scripts/payments/fixture.sql'));
await db.exec(await read('scripts/payments/assertions.sql'));
for(const name of (await readdir(new URL('../../supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await read('supabase/migrations/'+name));
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function fixture(age='10 minutes',status='waiting',claimed=false) {
 const c=await one("INSERT INTO bot_contacts(channel,external_contact_id,verification_source,verified_at) VALUES('whatsapp',gen_random_uuid()::text,'meta_whatsapp_signed_webhook',now()) RETURNING id");
 const v=await one("INSERT INTO bot_conversations(contact_id,channel,thread_id,content_version,status,current_state,parent_state,selected_site,selected_activity,collected_fields,expires_at) VALUES($1,'whatsapp',gen_random_uuid()::text,'test',$2,'menu.corporate_topics','menu.main','berko','berko_treasure','{\"package\":\"berko_treasure\"}',now()+interval '1 day') RETURNING id",[c.id,status==='active'?'human_active':'awaiting_human']);
 const e=await one("INSERT INTO bot_channel_events(channel,provider_event_id,event_kind,payload_digest,occurred_at) VALUES('whatsapp',gen_random_uuid()::text,'message',repeat('a',64),now()-interval '7 days') RETURNING id");
 await db.query("INSERT INTO bot_messages(conversation_id,trigger_event_id,channel,direction,message_kind,body,occurred_at) VALUES($1,$2,'whatsapp','inbound','text','8',now())",[v.id,e.id]);
 const h=await one("INSERT INTO bot_handoffs(conversation_id,reason,summary,status,created_at,claimed_at) VALUES($1,'unknown_question','old QA handoff',$2,clock_timestamp()-$3::interval,CASE WHEN $4 THEN now() ELSE NULL END) RETURNING id",[v.id,status,age,claimed]);
 return {v:v.id,e:e.id,h:h.id};
}
const release=f=>db.query("SELECT * FROM release_stale_bot_handoff($1,$2,'reset and main menu')",[f.v,f.e]);
for(const [age,expected] of [['9 minutes 59 seconds',0],['10 minutes',1],['1 day',1]]){
 const f=await fixture(age);eq((await release(f)).rows.length,expected);
 const v=await one('SELECT status,current_state,parent_state,selected_site,selected_activity,collected_fields,expires_at FROM bot_conversations WHERE id=$1',[f.v]);
 if(expected){eq(v,{status:'automated',current_state:'menu.main',parent_state:null,selected_site:null,selected_activity:null,collected_fields:{},expires_at:null});
 eq((await one('SELECT status,auto_release_event_id,auto_released_at IS NOT NULL audited FROM bot_handoffs WHERE id=$1',[f.h])),{status:'closed',auto_release_event_id:f.e,audited:true});
 eq((await release(f)).rows.length,0);eq((await one("SELECT count(*)::int n FROM bot_messages WHERE trigger_event_id=$1 AND direction='outbound' AND message_kind='text' AND asset_id IS NULL",[f.e])).n,1);
 }else eq(v.status,'awaiting_human');
}
for(const [status,claimed] of [['active',true],['waiting',true]]) eq((await release(await fixture('1 day',status,claimed))).rows.length,0);
const f=await fixture();eq((await Promise.all([release(f),release(f)])).map(x=>x.rows.length).sort(),[0,1]);
// Actual operator RPCs, preserving permission checks and both race serializations.
const admin='96000000-0000-4000-8000-000000000077';
await db.query("INSERT INTO auth.users(id) VALUES($1)",[admin]);
await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)");
await db.query("INSERT INTO profiles(id,full_name,role) VALUES($1,'Synthetic operator','admin') ON CONFLICT(id) DO UPDATE SET role='admin'",[admin]);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[admin]);
await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:admin,role:'authenticated'})]);
const firstClaim=await fixture('1 day');eq((await one('SELECT claim_bot_handoff($1) ok',[firstClaim.h])).ok,true);eq((await release(firstClaim)).rows.length,0);
eq((await one('SELECT resume_bot_conversation($1) ok',[firstClaim.h])).ok,true);eq((await one('SELECT status,current_state FROM bot_conversations WHERE id=$1',[firstClaim.v])),{status:'automated',current_state:'menu.main'});
const firstExpiry=await fixture('1 day');eq((await release(firstExpiry)).rows.length,1);eq((await one('SELECT claim_bot_handoff($1) ok',[firstExpiry.h])).ok,false);
const race=await fixture('1 day');const outcomes=await Promise.all([release(race),one('SELECT claim_bot_handoff($1) ok',[race.h])]);eq(Number(outcomes[0].rows.length===1)+Number(outcomes[1].ok),1);
const invalid=await fixture();await db.query("UPDATE bot_channel_events SET processing_status='completed' WHERE id=$1",[invalid.e]);eq((await release(invalid)).rows.length,0);
const roles=await fixture();for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(release(roles),/permission denied/);checks++;await db.exec('RESET ROLE');}
await db.exec('SET ROLE service_role');eq((await release(roles)).rows.length,1);await db.exec('RESET ROLE');
eq((await one("SELECT count(*)::int n FROM bot_messages WHERE response_id='handoff.auto_reset' AND (message_kind<>'text' OR asset_id IS NOT NULL)")).n,0);
eq((await one("SELECT count(*)::int n FROM leads")).n,0);
await db.close();console.log(`${checks} stale-handoff SQL checks passed. PGlite serializes connections: both claim/expiry orderings covered; not a multi-session lock test.`);
