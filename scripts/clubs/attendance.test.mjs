import { manualSessionCases } from './manual-session.cases.mjs';
// Disposable loopback PostgreSQL only. No environment/database credentials used.
// Install embedded-postgres in .tmp/clubs-runtime or set CLUBS_TEST_RUNTIME to its directory.
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import { instructorAttendanceCases } from './instructor-attendance.cases.mjs';
const root=resolve(import.meta.dirname,'../..');
const runtime=resolve(process.env.CLUBS_TEST_RUNTIME || resolve(root,'.tmp/clubs-runtime'));
const {default:EmbeddedPostgres}=await import(pathToFileURL(resolve(runtime,'node_modules/embedded-postgres/dist/index.js')));
const databaseDir=resolve(root,'.tmp/attendance-'+randomUUID());
await mkdir(databaseDir,{recursive:true});
const db=new EmbeddedPostgres({databaseDir,user:'postgres',password:randomUUID(),port:55447,persistent:true,initdbFlags:['--encoding=UTF8'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
let c; let checks=0;
const ok=(v,message)=>{assert.ok(v,message);checks++;};
try {
 await db.initialise();await db.start();c=db.getPgClient();await c.connect();
 await c.query("SET TIME ZONE 'Asia/Jerusalem'");
 await c.query(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE EXTENSION "uuid-ossp";
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text,role text);
 CREATE TABLE public.instructors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),full_name text,phone text);
 CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce((SELECT role='admin' FROM public.profiles WHERE id=auth.uid()),false) $$;
 CREATE FUNCTION public.update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
 `);
 for(const name of ['023_clubs_and_recurring_billing.sql','028_clubs_operational_rules.sql',...(await readdir(resolve(root,'supabase/migrations'))).filter(n=>n.endsWith('_clubs_attendance.sql') || n.endsWith('_instructor_attendance.sql') || n.endsWith('_manual_club_session.sql')).sort()]){
  await c.query(await readFile(resolve(root,'supabase/migrations',name),'utf8'));
 }
 const admin=randomUUID(),other=randomUUID(),club=randomUUID(),participant=randomUUID(),member=randomUUID(),rule=randomUUID();
 await c.query("INSERT INTO profiles VALUES ($1,'Synthetic admin','admin'),($2,'Synthetic instructor','instructor')",[admin,other]);
 await c.query("INSERT INTO clubs(id,name,monthly_price) VALUES ($1,'Synthetic club',0);",[club]);
 await c.query("INSERT INTO club_participants(id,first_name,last_name) VALUES ($1,'Synthetic','Participant')",[participant]);
 await c.query("INSERT INTO club_memberships(id,club_id,participant_id,starts_on,monthly_price,billing_day,recurring_starts_on) VALUES ($1,$2,$3,current_date-10,0,15,current_date+30)",[member,club,participant]);
 await c.query("INSERT INTO club_schedule_rules(id,club_id,weekday,start_time,end_time) VALUES ($1,$2,extract(dow from current_date), '16:00','17:00')",[rule,club]);
 const financial=async()=> (await c.query("SELECT (SELECT count(*) FROM recurring_agreements) agreements,(SELECT count(*) FROM recurring_charges) charges,(SELECT md5(string_agg(row_to_json(m)::text,'' ORDER BY id)) FROM club_memberships m) memberships")).rows[0];
 const before=await financial();
 const login=async(client,id)=>{await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await client.query('SET ROLE authenticated');};
 await login(c,admin);
 const generate=()=>c.query('SELECT materialize_club_sessions($1,current_date,current_date+7)',[club]);
 await generate();await generate();
 let sessions=(await c.query('SELECT * FROM club_sessions ORDER BY session_date')).rows;
 ok(sessions.length===2,'materialization is duplicate safe');
 const s=sessions[0];
 ok(s.timezone==='Asia/Jerusalem','Israel wall-clock timezone persisted');
 await c.query('SELECT prepare_club_roster($1)',[s.id]);
 ok((await c.query('SELECT * FROM club_session_roster')).rowCount===1,'pending enrollment eligible without billing');
 await c.query("SELECT mark_club_attendance($1,$2,'present',0,'')",[s.id,member]);
 await c.query("SELECT mark_club_attendance($1,$2,'absent',1,'Correction')",[s.id,member]);
 ok((await c.query('SELECT * FROM club_attendance')).rows[0].version===2,'correction increments version');
 ok((await c.query('SELECT * FROM club_attendance_audit')).rowCount===2,'immutable audit preserves both marks');
 await assert.rejects(c.query("SELECT mark_club_attendance($1,$2,'present',1,'')",[s.id,member]),/attendance_conflict/);checks++;
 await assert.rejects(c.query("DELETE FROM club_attendance"),/permission denied/);checks++;
 await c.query("SELECT update_club_session($1,0,'cancelled',null,'Cancelled')",[s.id]);
 await generate();
 ok((await c.query('SELECT status FROM club_sessions WHERE id=$1',[s.id])).rows[0].status==='cancelled','cancelled session never regenerated');
 await assert.rejects(c.query("SELECT mark_club_attendance($1,$2,'present',2,'')",[s.id,member]),/session_cancelled/);checks++;
 await c.query("UPDATE club_schedule_rules SET start_time='18:00',end_time='19:00' WHERE id=$1",[rule]);
 await generate();
 ok((await c.query('SELECT start_time FROM club_sessions WHERE id=$1',[s.id])).rows[0].start_time==='16:00:00','schedule changes preserve existing sessions');
 await assert.rejects(c.query('SELECT materialize_club_sessions($1,current_date,current_date+100)',[club]),/invalid_date_range/);checks++;
 await c.query('RESET ROLE');await login(c,other);
 ok((await c.query('SELECT * FROM club_sessions')).rowCount===0,'non-admin cannot read sessions');
 await assert.rejects(generate(),/admin_required/);checks++;
 await assert.rejects(c.query('SELECT prepare_club_roster($1)',[s.id]),/admin_required/);checks++;
 await assert.rejects(c.query("SELECT mark_club_attendance($1,$2,'present',2,'')",[s.id,member]),/admin_required/);checks++;
 await c.query('RESET ROLE');
 assert.deepEqual(await financial(),before);checks++;
 // Further isolated fixtures cover eligibility, history and real concurrent clients.
 const club2=randomUUID(),rule2=randomUUID(),instructor=randomUUID();
 await c.query("INSERT INTO instructors(id,full_name) VALUES($1,'Synthetic instructor')",[instructor]);
 await c.query("INSERT INTO clubs(id,name,monthly_price,instructor_id) VALUES($1,'Other club',0,$2)",[club2,instructor]);
 await c.query("INSERT INTO club_schedule_rules(id,club_id,weekday,start_time,end_time,effective_from,effective_until) VALUES($1,$2,extract(dow from current_date),'16:00','17:00',current_date-7,current_date+7)",[rule2,club2]);
 const fixtureMember=async(status,starts,ends,cancel)=>{
   const p=randomUUID(),m=randomUUID();
   await c.query("INSERT INTO club_participants(id,first_name,last_name) VALUES($1,'Fixture','Participant')",[p]);
   await c.query("INSERT INTO club_memberships(id,club_id,participant_id,status,starts_on,ends_on,cancellation_effective_on,monthly_price,billing_day,recurring_starts_on) VALUES($1,$2,$3,$4,current_date+$5::int,CASE WHEN $6::int IS NULL THEN NULL ELSE current_date+$6::int END,CASE WHEN $7::int IS NULL THEN NULL ELSE current_date+$7::int END,0,15,current_date+30)",[m,club2,p,status,starts,ends,cancel]);
   return m;
 };
 const eligible=await fixtureMember('active',-10,null,null);
 await fixtureMember('paused',-10,null,null);
 await fixtureMember('active',1,null,null);
 await fixtureMember('ended',-10,-1,null);
 await fixtureMember('cancelled',-10,null,0);
 await fixtureMember('cancellation_scheduled',-10,null,1);
 await fixtureMember('ended',-10,0,null);
 await fixtureMember('cancelled',-10,null,null); // undated cancellation is not inferred
 const before2=await financial();
 await login(c,admin);
 await c.query('SELECT materialize_club_sessions($1,current_date-7,current_date+14)',[club2]);
 const s2=(await c.query('SELECT * FROM club_sessions WHERE club_id=$1 AND session_date=current_date',[club2])).rows[0];
 ok(s2.instructor_id===instructor && s2.instructor_name==='Synthetic instructor','instructor snapshot copied from club');
 ok((await c.query('SELECT * FROM club_sessions WHERE club_id=$1',[club2])).rowCount===3,'effective schedule bounds applied');
 await c.query('SELECT prepare_club_roster($1)',[s2.id]);await c.query('SELECT prepare_club_roster($1)',[s2.id]);
 ok((await c.query('SELECT * FROM club_session_roster WHERE session_id=$1',[s2.id])).rowCount===3,'dated eligibility, pending/ended/paused/cancellation boundaries and duplicate roster protection');
 await assert.rejects(c.query("SELECT mark_club_attendance($1,$2,'present',0,'')",[s2.id,member]),/participant_not_in_roster/);checks++;
 await assert.rejects(c.query("SELECT mark_club_attendance($1,$2,'invented',0,'')",[s2.id,eligible]),/invalid_attendance/);checks++;
 const c2=db.getPgClient();await c2.connect();
 try {
   await login(c2,admin);
   const concurrent=await Promise.allSettled([c.query("SELECT mark_club_attendance($1,$2,'present',0,'First')",[s2.id,eligible]),c2.query("SELECT mark_club_attendance($1,$2,'absent',0,'Other')",[s2.id,eligible])]);
   ok(concurrent.filter(r=>r.status==='fulfilled').length===1,'concurrent mark has exactly one winner');
   ok(concurrent.some(r=>r.status==='rejected'&&/attendance_conflict/.test(r.reason.message)),'concurrent loser receives explicit conflict');
   await Promise.all([c.query('SELECT materialize_club_sessions($1,current_date,current_date+7)',[club2]),c2.query('SELECT materialize_club_sessions($1,current_date,current_date+7)',[club2])]);
   ok((await c.query('SELECT * FROM club_sessions WHERE club_id=$1',[club2])).rowCount===3,'concurrent materialization is duplicate safe');
 } finally {await c2.end();}
 await c.query("SELECT mark_club_attendance($1,$2,'excused',1,'Correction')",[s2.id,eligible]);
 const audit=(await c.query('SELECT * FROM club_attendance_audit WHERE session_id=$1 ORDER BY version',[s2.id])).rows;
 ok(audit.length===2 && audit[1].actor_id===admin && audit[1].actor_name==='Synthetic admin' && audit[1].old_status && audit[1].changed_at,'audit records actual editor/time and old/new values');
 const history=(await c.query('SELECT get_club_attendance_history($1,current_date,current_date)',[club2])).rows[0].get_club_attendance_history;
 ok(history.length===3&&history.find(r=>r.membership_id===eligible).status==='excused','history includes unmarked and marked roster without financial joins');
 for(const table of ['club_session_roster','club_attendance_audit','club_session_audit']) {
   await assert.rejects(c.query('DELETE FROM '+table),/permission denied/);checks++;
 }
 await assert.rejects(c.query('UPDATE club_sessions SET session_date=current_date+1'),/permission denied/);checks++;
 await assert.rejects(c.query('DELETE FROM clubs WHERE id=$1',[club2]),/session_history_immutable/);checks++;
 // Existing save_club_with_schedule deletes/replaces rule rows. Its FK action
 // must remain compatible with immutable persisted session snapshots.
 await c.query('DELETE FROM club_schedule_rules WHERE id=$1',[rule2]);
 const preserved=(await c.query('SELECT * FROM club_sessions WHERE id=$1',[s2.id])).rows[0];
 ok(preserved.schedule_rule_id===null && preserved.schedule_snapshot.rule_id===rule2 && preserved.session_date.toISOString().slice(0,10)===s2.session_date.toISOString().slice(0,10),'replacing rules preserves snapshot and dated history');
 await c.query("SELECT update_club_session($1,0,'completed',$2,'Completed')",[s2.id,instructor]);
 await c.query("SELECT mark_club_attendance($1,$2,'present',2,'Reviewed')",[s2.id,eligible]);
 await assert.rejects(c.query("SELECT update_club_session($1,0,'cancelled',$2,'')",[s2.id,instructor]),/session_conflict/);checks++;
 ok((await c.query('SELECT * FROM club_session_audit WHERE session_id=$1',[s2.id])).rowCount===1,'session correction has audit/version');
 await assert.rejects(c.query('SELECT materialize_club_sessions($1,null,current_date)',[club2]),/invalid_date_range/);checks++;
 await assert.rejects(c.query('SELECT materialize_club_sessions($1,current_date+91,current_date+91)',[club2]),/invalid_date_range/);checks++;
 const future=(await c.query('SELECT id FROM club_sessions WHERE club_id=$1 AND session_date>current_date LIMIT 1',[club2])).rows[0];
 await c.query('SELECT prepare_club_roster($1)',[future.id]);
 await assert.rejects(c.query("SELECT mark_club_attendance($1,$2,'present',0,'')",[future.id,eligible]),/future_attendance/);checks++;
 await c.query('RESET ROLE');assert.deepEqual(await financial(),before2);checks++;
 // Membership edits are fixture-only: saved roster/marks must not disappear.
 await c.query("UPDATE club_memberships SET status='paused' WHERE id=$1",[eligible]);
 await login(c,admin);await c.query('SELECT prepare_club_roster($1)',[s2.id]);
 ok((await c.query('SELECT * FROM club_session_roster WHERE session_id=$1 AND membership_id=$2',[s2.id,eligible])).rowCount===1,'later membership changes preserve attendance roster');
 await c.query('RESET ROLE');
 for(const role of ['instructor','cashier','operations']) {
   await c.query('UPDATE profiles SET role=$1 WHERE id=$2',[role,other]);await login(c,other);
   await assert.rejects(c.query('SELECT get_club_attendance_history($1,current_date,current_date)',[club2]),/admin_required/);checks++;
   ok((await c.query('SELECT * FROM club_attendance_audit')).rowCount===0,role+' cannot read audit');
   await assert.rejects(c.query("SELECT update_club_session($1,1,'cancelled',null,'')",[s2.id]),/admin_required/);checks++;
   await c.query('RESET ROLE');
 }
 await c.query('SET ROLE anon');
 await assert.rejects(c.query('SELECT materialize_club_sessions($1,current_date,current_date)',[club]),/permission denied/);checks++;
 await c.query('RESET ROLE');
 const empty=randomUUID();await c.query("INSERT INTO clubs(id,name,monthly_price) VALUES($1,'Empty',0)",[empty]);
 await login(c,admin);
 ok((await c.query('SELECT materialize_club_sessions($1,current_date,current_date)',[empty])).rows[0].materialize_club_sessions===0,'empty schedule generates nothing');
 ok((await c.query('SELECT get_club_attendance_history($1,current_date,current_date)',[empty])).rows[0].get_club_attendance_history.length===0,'empty history supported');
 await c.query("INSERT INTO club_schedule_rules(club_id,weekday,start_time,end_time) VALUES($1,extract(dow from current_date),'10:00','11:00')",[empty]);
 await c.query('SELECT materialize_club_sessions($1,current_date,current_date)',[empty]);
 const emptySession=(await c.query('SELECT id FROM club_sessions WHERE club_id=$1',[empty])).rows[0].id;
 ok((await c.query('SELECT prepare_club_roster($1)',[emptySession])).rows[0].prepare_club_roster===0,'session with no participants is valid');
 await c.query("INSERT INTO club_schedule_rules(club_id,weekday,start_time,end_time) VALUES($1,extract(dow from current_date),'10:00','12:00')",[empty]);
 await assert.rejects(c.query('SELECT materialize_club_sessions($1,current_date,current_date)',[empty]),/overlapping_schedule_rules/);checks++;
 await c.query("SELECT update_club_session($1,0,'cancelled',null,'Cancelled')",[emptySession]);
 await assert.rejects(c.query("SELECT update_club_session($1,1,'scheduled',null,'Restore')",[emptySession]),/session_cancelled/);checks++;
 await c.query('RESET ROLE');
 // An ambiguous pair of eligible memberships must never silently choose an ID.
 await c.query("UPDATE club_memberships SET status='ended',ends_on=current_date+1 WHERE id=$1",[eligible]);
 const duplicate=randomUUID();
 await c.query("INSERT INTO club_memberships(id,club_id,participant_id,status,starts_on,monthly_price,billing_day,recurring_starts_on) SELECT $1,club_id,participant_id,'active',current_date-10,0,15,current_date+30 FROM club_memberships WHERE id=$2",[duplicate,eligible]);
 const fresh=randomUUID();
 await c.query("INSERT INTO club_sessions(id,club_id,session_date,start_time,end_time) VALUES($1,$2,current_date,'09:00','10:00')",[fresh,club2]);
 await login(c,admin);
 await assert.rejects(c.query('SELECT prepare_club_roster($1)',[fresh]),/ambiguous_membership_dates/);checks++;
 console.log('PASS '+checks+' PostgreSQL admin attendance assertions; operational calls left financial state unchanged');
 await c.query('RESET ROLE');
 await instructorAttendanceCases({c,db,login,admin});
 await manualSessionCases({c,db,login,admin});
} finally {if(c)await c.end();await db.stop();}
