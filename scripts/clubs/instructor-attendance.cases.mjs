import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function instructorAttendanceCases({c,db,login,admin}) {
 let checks=0;
 const ok=(value,label)=>{assert.ok(value,label);checks++;};
 const denied=async(promise,pattern=/attendance_forbidden|admin_required|permission denied/)=>{await assert.rejects(promise,pattern);checks++;};
 const a=randomUUID(),b=randomUUID(),unlinked=randomUUID(),ia=randomUUID(),ib=randomUUID(),club=randomUUID(),m=randomUUID(),p=randomUUID();
 // Contact columns exist in production schema; add them to the minimal fixture.
 await c.query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text; ALTER TABLE instructors ADD COLUMN IF NOT EXISTS email text; ALTER TABLE instructors ADD COLUMN IF NOT EXISTS phone text');
 await c.query("INSERT INTO profiles(id,full_name,role) VALUES($1,'Same name','instructor'),($2,'Same name','instructor'),($3,'Same name','instructor')",[a,b,unlinked]);
 await c.query("INSERT INTO instructors(id,full_name) VALUES($1,'Same name'),($2,'Same name')",[ia,ib]);
 await c.query("UPDATE profiles SET email='same@example.invalid' WHERE id IN ($1,$2,$3)",[a,b,unlinked]);
 await c.query("UPDATE instructors SET email='same@example.invalid',phone='synthetic' WHERE id IN ($1,$2)",[ia,ib]);
 await c.query("INSERT INTO clubs(id,name,monthly_price,instructor_id) VALUES($1,'Instructor club',0,$2)",[club,ia]);
 await c.query("INSERT INTO club_participants(id,first_name,last_name) VALUES($1,'Synthetic','Student')",[p]);
 await c.query("INSERT INTO club_memberships(id,club_id,participant_id,starts_on,monthly_price,billing_day,recurring_starts_on) VALUES($1,$2,$3,current_date-30,0,15,current_date+30)",[m,club,p]);
 const fixtureSession=async(instructor,offset,status='scheduled')=>{
  const id=randomUUID();await c.query("INSERT INTO club_sessions(id,club_id,instructor_id,session_date,start_time,end_time,status) VALUES($1,$2,$3,current_date+$4::int,'10:00','11:00',$5)",[id,club,instructor,offset,status]);return id;
 };
 const own=await fixtureSession(ia,0),other=await fixtureSession(ib,-1),future=await fixtureSession(ia,1),cancelled=await fixtureSession(ia,-2,'cancelled');
 const snapshot=async()=> (await c.query("SELECT (SELECT md5(string_agg(row_to_json(m)::text,'' ORDER BY id)) FROM club_memberships m) memberships,(SELECT count(*) FROM recurring_agreements) agreements,(SELECT count(*) FROM recurring_charges) charges")).rows[0];
 const before=await snapshot();
 await login(c,admin);
 await c.query('SELECT set_instructor_user_link($1,$2,0)',[ia,a]);
 await c.query('SELECT set_instructor_user_link($1,$2,0)',[ib,b]);
 ok((await c.query('SELECT * FROM instructor_user_links WHERE profile_id=$1',[a])).rowCount===1,'admin establishes explicit link');
 await denied(c.query('SELECT set_instructor_user_link($1,$2,1)',[ia,b]),/already_linked/);
 await denied(c.query('SELECT set_instructor_user_link($1,$2,1)',[ia,admin]),/instructor_role_required/);
 await denied(c.query('SELECT set_instructor_user_link($1,$2,0)',[ia,a]),/link_conflict/);
 await denied(c.query('SELECT set_instructor_user_link($1,$2,1)',[ia,randomUUID()]),/instructor_role_required/);
 await denied(c.query('SELECT set_instructor_user_link($1,$2,0)',[randomUUID(),unlinked]),/instructor_not_found/);
 ok((await c.query('SELECT * FROM instructor_user_link_audit')).rowCount===2,'failed links do not add audit records');
 await c.query('RESET ROLE');
 await c.query("UPDATE instructors SET full_name='Changed business name',email='different@example.invalid',phone='changed' WHERE id=$1",[ia]);
 await c.query('RESET ROLE');await c.query("UPDATE profiles SET full_name='Changed user',email='another@example.invalid' WHERE id=$1",[a]);await login(c,admin);
 await c.query('SELECT prepare_club_roster($1)',[other]);
 await c.query('RESET ROLE');await login(c,unlinked);
 ok((await c.query('SELECT get_instructor_club_sessions(current_date-7,current_date+7)')).rows[0].get_instructor_club_sessions.sessions.length===0,'matching name without explicit link grants nothing');
 await denied(c.query('SELECT get_instructor_club_roster($1)',[own]));
 await c.query('RESET ROLE');await login(c,a);
 const list=(await c.query('SELECT get_instructor_club_sessions(current_date-7,current_date+7)')).rows[0].get_instructor_club_sessions;
 ok(list.linked && list.sessions.length===3 && !list.sessions.some(s=>s.id===other),'explicit link survives name/email/phone changes and exposes only assigned sessions');
 ok(list.sessions.every(s=>Object.keys(s).sort().join(',')==='club_name,end_time,id,session_date,start_time,status'),'session projection contains only operational fields');
 await denied(c.query('SELECT get_instructor_club_roster($1)',[other]));
 await denied(c.query('SELECT get_instructor_club_roster($1)',[randomUUID()]));
 await denied(c.query('SELECT prepare_club_roster($1)',[other]));
 await c.query('SELECT prepare_club_roster($1)',[own]);
 const roster=(await c.query('SELECT get_instructor_club_roster($1)',[own])).rows[0].get_instructor_club_roster;
 ok(roster.length===1 && roster[0].participant_name==='Synthetic Student','own roster can be prepared and viewed');
 ok(Object.keys(roster[0]).sort().join(',')==='membership_id,notes,participant_name,status,updated_at,version','no contact, billing or actor identity data in instructor roster');
 await c.query("SELECT mark_club_attendance($1,$2,'present',0,'First')",[own,m]);
 await c.query("SELECT mark_club_attendance($1,$2,'excused',1,'Correction')",[own,m]);
 await denied(c.query("SELECT mark_club_attendance($1,$2,'absent',1,'Stale')",[own,m]),/attendance_conflict/);
 await denied(c.query("SELECT mark_club_attendance($1,$2,'present',0,'')",[other,m]));
 await denied(c.query('SELECT materialize_club_sessions($1,current_date,current_date)',[club]));
 await denied(c.query("SELECT update_club_session($1,0,'completed',$2,'')",[own,ia]));
 await denied(c.query('SELECT get_club_attendance_history($1,current_date,current_date)',[club]));
 await denied(c.query('SELECT set_instructor_user_link($1,$2,1)',[ib,a]));
 await denied(c.query('UPDATE instructor_user_links SET profile_id=$1',[a]));
 await denied(c.query('SELECT get_instructor_user_links()'));
 for(const table of ['clubs','club_memberships','club_participants','club_sessions','club_session_roster','club_attendance','club_attendance_audit','instructor_user_links','instructor_user_link_audit','recurring_agreements','recurring_charges']) {
  ok((await c.query('SELECT * FROM '+table)).rowCount===0,table+' raw rows remain unavailable to instructor');
 }
 await denied(c.query('SELECT prepare_club_roster($1)',[cancelled]),/session_cancelled/);
 await denied(c.query("SELECT mark_club_attendance($1,$2,'present',0,'')",[cancelled,m]),/session_cancelled/);
 await c.query('SELECT prepare_club_roster($1)',[future]);
 await denied(c.query("SELECT mark_club_attendance($1,$2,'present',0,'')",[future,m]),/future_attendance/);
 await denied(c.query('SELECT get_instructor_club_sessions(current_date,current_date+70)'),/invalid_date_range/);
 const concurrent=db.getPgClient();await concurrent.connect();
 try {
  await login(concurrent,a);
  const results=await Promise.allSettled([c.query("SELECT mark_club_attendance($1,$2,'present',2,'One')",[own,m]),concurrent.query("SELECT mark_club_attendance($1,$2,'absent',2,'Two')",[own,m])]);
  ok(results.filter(r=>r.status==='fulfilled').length===1,'exactly one instructor concurrent edit succeeds');
 }finally{await concurrent.end();}
 await c.query('RESET ROLE');await login(c,admin);
 await c.query('UPDATE clubs SET instructor_id=$1 WHERE id=$2',[ib,club]);
 ok((await c.query('SELECT instructor_id FROM club_sessions WHERE id=$1',[own])).rows[0].instructor_id===ia,'club reassignment preserves historical session ownership');
 ok((await c.query('SELECT actor_id FROM club_attendance_audit WHERE session_id=$1',[own])).rows.every(r=>r.actor_id===a),'instructor edits retain actual audit actor');
 await c.query("SELECT update_club_session($1,0,'scheduled',$2,'Explicit substitute')",[own,ib]);
 await c.query('RESET ROLE');await login(c,a);await denied(c.query('SELECT get_instructor_club_roster($1)',[own]));
 await denied(c.query("SELECT mark_club_attendance($1,$2,'present',3,'')",[own,m]));
 await c.query('RESET ROLE');await login(c,b);
 ok((await c.query('SELECT get_instructor_club_roster($1)',[own])).rows[0].get_instructor_club_roster[0].version===3,'explicit substitute sees retained attendance');
 await c.query("SELECT mark_club_attendance($1,$2,'present',3,'Substitute')",[own,m]);
 await c.query('RESET ROLE');await login(c,admin);
 await c.query('SELECT set_instructor_user_link($1,null,1)',[ib]);
 await c.query('RESET ROLE');await login(c,b);await denied(c.query('SELECT get_instructor_club_roster($1)',[own]));
 await c.query('RESET ROLE');await login(c,admin);
 await c.query('SELECT set_instructor_user_link($1,$2,2)',[ib,b]);
 for(const role of ['cashier','operations']) {
  await c.query('RESET ROLE');await c.query('UPDATE profiles SET role=$1 WHERE id=$2',[role,b]);await login(c,b);
  await denied(c.query('SELECT get_instructor_club_sessions(current_date,current_date)'));
  await denied(c.query('SELECT get_instructor_club_roster($1)',[own]));
  await denied(c.query("SELECT mark_club_attendance($1,$2,'present',4,'')",[own,m]));
 }
 await c.query('RESET ROLE');
 assert.deepEqual(await snapshot(),before);checks++;
 // Competing administrators cannot assign the same user to two instructors.
 const ic=randomUUID(),id=randomUUID();
 await c.query("INSERT INTO instructors(id,full_name) VALUES($1,'C'),($2,'D')",[ic,id]);
 await login(c,admin);
 const linker=db.getPgClient();await linker.connect();
 try{
  await login(linker,admin);
  const results=await Promise.allSettled([c.query('SELECT set_instructor_user_link($1,$2,0)',[ic,unlinked]),linker.query('SELECT set_instructor_user_link($1,$2,0)',[id,unlinked])]);
  ok(results.filter(r=>r.status==='fulfilled').length===1,'unique user link holds under concurrent admin requests');
 }finally{await linker.end();}
 await c.query('RESET ROLE');
 await denied(c.query('DELETE FROM profiles WHERE id=$1',[b]),/foreign key constraint/);
 await login(c,admin);await c.query('SELECT set_instructor_user_link($1,null,3)',[ib]);
 await c.query('RESET ROLE');await c.query('DELETE FROM profiles WHERE id=$1',[b]);
 ok((await c.query('SELECT * FROM club_attendance_audit WHERE actor_id=$1',[b])).rowCount===1,'unlink permits user deletion without erasing prior attendance audit');
 await c.query('SET ROLE anon');await denied(c.query('SELECT get_instructor_club_sessions(current_date,current_date)'));
 await c.query('RESET ROLE');
 console.log('PASS '+checks+' PostgreSQL instructor identity/access assertions; financial state unchanged');
}
