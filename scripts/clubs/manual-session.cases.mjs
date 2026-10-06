import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function manualSessionCases({c,db,login,admin}) {
 let checks=0;const ok=(x,m)=>{assert.ok(x,m);checks++;};const denied=async(p,re)=>{await assert.rejects(p,re);checks++;};
 await c.query('RESET ROLE');const club=randomUUID(),teacher=randomUUID(),other=randomUUID(),part=randomUUID(),member=randomUUID();
 await c.query("INSERT INTO instructors(id,full_name,phone) VALUES($1,'Manual synthetic instructor','synthetic')",[teacher]);
 if((await c.query("SELECT to_regclass('auth.users') x")).rows[0].x)await c.query('INSERT INTO auth.users(id) VALUES($1)',[other]);
 await c.query("INSERT INTO profiles(id,full_name,role) VALUES($1,'Manual synthetic instructor','instructor')",[other]);
 await c.query("INSERT INTO clubs(id,name,monthly_price,instructor_id) VALUES($1,'Manual synthetic club',0,$2)",[club,teacher]);
 await c.query("INSERT INTO club_participants(id,first_name,last_name) VALUES($1,'Manual','Participant')",[part]);
 await c.query("INSERT INTO club_memberships(id,club_id,participant_id,starts_on,monthly_price,billing_day,recurring_starts_on) VALUES($1,$2,$3,current_date-1,0,15,current_date+30)",[member,club,part]);
 const financial=async()=> (await c.query("SELECT (SELECT count(*) FROM recurring_agreements) agreements,(SELECT count(*) FROM recurring_charges) charges,(SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY id)::text) FROM club_memberships m) memberships")).rows[0];const before=await financial();
 await login(c,admin);
 const create=(start='10:00',end='11:00',date='current_date',instructor=teacher)=>c.query(`SELECT create_manual_club_session($1,${date},$2::time,$3::time,$4,'Makeup') id`,[club,start,end,instructor]);
 const id=(await create()).rows[0].id;ok(!!id,'persisted manual ID');
 const row=(await c.query('SELECT * FROM club_sessions WHERE id=$1',[id])).rows[0];ok(row.schedule_rule_id===null&&row.schedule_snapshot.source==='manual'&&row.instructor_id===teacher&&row.timezone==='Asia/Jerusalem','same frozen session model');
 ok((await c.query('SELECT * FROM club_session_audit WHERE session_id=$1',[id])).rows[0].old_status==='not_created','creation audit');
 await denied(create(),/session_exists/);await denied(create('10:00','12:00'),/session_exists/);
 await denied(create('12:00','11:00'),/invalid_session_time/);await denied(create(null,'11:00'),/invalid_session_time/);
 await denied(create('12:00','13:00',"'2026-02-30'::date"),/date\/time field value out of range/);
 await denied(create('12:00','13:00','current_date+91'),/invalid_date_range/);
 await denied(create('12:00','13:00','current_date',randomUUID()),/instructor_not_found/);
 await denied(c.query("SELECT create_manual_club_session($1,current_date,'12:00','13:00',null,'')",[randomUUID()]),/club_not_found/);
 await c.query('SELECT prepare_club_roster($1)',[id]);await c.query("SELECT mark_club_attendance($1,$2,'present',0,'')",[id,member]);await c.query("SELECT mark_club_attendance($1,$2,'excused',1,'Correction')",[id,member]);
 ok((await c.query('SELECT version FROM club_attendance WHERE session_id=$1',[id])).rows[0].version===2,'existing marking/correction workflow');
 await c.query('UPDATE clubs SET instructor_id=null WHERE id=$1',[club]);ok((await c.query('SELECT instructor_id FROM club_sessions WHERE id=$1',[id])).rows[0].instructor_id===teacher,'club edits preserve frozen session instructor');
 await c.query("SELECT update_club_session($1,0,'scheduled',null,'Reassign')",[id]);await c.query("SELECT update_club_session($1,1,'cancelled',null,'Cancel')",[id]);await denied(create(),/session_exists/);
 await denied(c.query("SELECT mark_club_attendance($1,$2,'absent',2,'')",[id,member]),/session_cancelled/);
 await c.query("INSERT INTO club_schedule_rules(club_id,weekday,start_time,end_time,effective_from) VALUES($1,extract(dow from current_date),'10:00','11:00',current_date)",[club]);
 ok((await c.query('SELECT materialize_club_sessions($1,current_date,current_date)',[club])).rows[0].materialize_club_sessions===0,'weekly generation neither duplicates nor resurrects cancelled manual session');
 await c.query('SELECT materialize_club_sessions($1,current_date+7,current_date+7)',[club]);
 await denied(create('10:00','11:00','current_date+7'),/session_exists/);
 await c.query("UPDATE clubs SET status='inactive' WHERE id=$1",[club]);await denied(create('12:00','13:00'),/club_inactive/);await c.query("UPDATE clubs SET status='active' WHERE id=$1",[club]);
 const future=(await create('10:00','11:00','current_date+1',null)).rows[0].id;await c.query('SELECT prepare_club_roster($1)',[future]);await denied(c.query("SELECT mark_club_attendance($1,$2,'present',0,'')",[future,member]),/future_attendance/);
 const c2=db.getPgClient();await c2.connect();try{await login(c2,admin);const results=await Promise.allSettled([create('14:00','15:00'),c2.query("SELECT create_manual_club_session($1,current_date,'14:00','15:00',null,'Other')",[club])]);ok(results.filter(r=>r.status==='fulfilled').length===1&&results.some(r=>r.status==='rejected'&&/session_exists/.test(r.reason.message)),'concurrent creation has one winner');}finally{await c2.end();}
 await login(c,other);await denied(create('16:00','17:00'),/admin_required/);
 await c.query('RESET ROLE');await c.query('SET ROLE anon');await denied(create('16:00','17:00'),/permission denied/);
 await c.query('RESET ROLE');assert.deepEqual(await financial(),before);checks++;console.log('PASS '+checks+' manual session DB assertions; financial state unchanged');
}
