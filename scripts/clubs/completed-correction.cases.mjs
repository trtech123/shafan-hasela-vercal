import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function completedCorrectionCases({c,db,login,admin}) {
 let checks=0;const ok=(x,m)=>{assert.ok(x,m);checks++;};const denied=async(p,re)=>{await assert.rejects(p,re);checks++;};
 await c.query('RESET ROLE');const club=randomUUID(),teacher=randomUUID(),other=randomUUID(),part=randomUUID(),member=randomUUID();
 await c.query("INSERT INTO instructors(id,full_name,phone) VALUES($1,'Correction synthetic instructor','synthetic')",[teacher]);
 if((await c.query("SELECT to_regclass('auth.users') x")).rows[0].x)await c.query('INSERT INTO auth.users(id) VALUES($1)',[other]);
 await c.query("INSERT INTO profiles(id,full_name,role) VALUES($1,'Correction synthetic instructor','instructor')",[other]);
 await c.query("INSERT INTO clubs(id,name,monthly_price,instructor_id) VALUES($1,'Correction synthetic club',0,$2)",[club,teacher]);
 await c.query("INSERT INTO club_participants(id,first_name,last_name) VALUES($1,'Correction','Participant')",[part]);
 await c.query("INSERT INTO club_memberships(id,club_id,participant_id,starts_on,monthly_price,billing_day,recurring_starts_on) VALUES($1,$2,$3,current_date-1,0,15,current_date+30)",[member,club,part]);
 await login(c,admin);await c.query('SELECT set_instructor_user_link($1,$2,0)',[teacher,other]);
 const id=(await c.query("SELECT create_manual_club_session($1,current_date,'10:00','11:00',$2,'') id",[club,teacher])).rows[0].id;
 await c.query('SELECT prepare_club_roster($1)',[id]);
 const mark=(status,version,notes)=>c.query('SELECT mark_club_attendance($1,$2,$3,$4,$5)',[id,member,status,version,notes]);
 await mark('absent',0,'Original');
 const original=(await c.query('SELECT * FROM club_attendance_audit WHERE session_id=$1',[id])).rows;
 await c.query("SELECT update_club_session($1,0,'completed',$2,'Completed')",[id,teacher]);
 for(const reason of [null,'','   ','\t\n'])await denied(mark('present',1,reason),/correction_reason_required/);
 await mark('present',1,'Confirmed with instructor');
 const audit=(await c.query('SELECT * FROM club_attendance_audit WHERE session_id=$1 ORDER BY version',[id])).rows;
 assert.deepEqual(audit[0],original[0]);checks++;
 ok(audit.length===2&&audit[1].old_status==='absent'&&audit[1].new_status==='present'&&audit[1].old_notes==='Original'&&audit[1].new_notes==='Confirmed with instructor'&&audit[1].actor_id===admin&&audit[1].changed_at,'append-only correction audit preserves before/after, reason, actor and time');
 await denied(mark('excused',1,'Stale correction'),/attendance_conflict/);
 const c2=db.getPgClient();await c2.connect();try{await login(c2,admin);const results=await Promise.allSettled([mark('excused',2,'Correction A'),c2.query("SELECT mark_club_attendance($1,$2,'absent',2,'Correction B')",[id,member])]);ok(results.filter(x=>x.status==='fulfilled').length===1&&results.some(x=>x.status==='rejected'&&/attendance_conflict/.test(x.reason.message)),'concurrent correction one winner');}finally{await c2.end();}
 await login(c,other);await denied(mark('present',3,'Instructor reason'),/session_completed/);
 await login(c,admin);await c.query("SELECT update_club_session($1,1,'cancelled',$2,'Cancelled')",[id,teacher]);await denied(mark('present',3,'Admin reason'),/session_cancelled/);
 await login(c,other);await denied(mark('present',3,'Instructor reason'),/session_cancelled/);
 await login(c,admin);const future=(await c.query("SELECT create_manual_club_session($1,current_date+1,'10:00','11:00',$2,'') id",[club,teacher])).rows[0].id;await c.query('SELECT prepare_club_roster($1)',[future]);
 await denied(c.query("SELECT mark_club_attendance($1,$2,'present',0,'Reason')",[future,member]),/future_attendance/);
 await c.query('RESET ROLE');console.log('PASS '+checks+' completed correction DB assertions');
}
