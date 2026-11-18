import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import assert from 'node:assert/strict';

const db = new PGlite({ extensions: { 'uuid-ossp': uuid_ossp, pg_trgm } });
const migrations = resolve(import.meta.dirname, '../../supabase/migrations');
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA extensions;
  CREATE FUNCTION extensions.uuid_generate_v4() RETURNS uuid LANGUAGE sql VOLATILE AS
    'SELECT pg_catalog.gen_random_uuid()';
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    'SELECT nullif(current_setting(''app.test_uid'',true),'''')::uuid';
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
    'SELECT current_setting(''app.test_role'',true)';
  CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  SELECT set_config('app.test_role','service_role',false);
`);
let count = 0;
for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
  try { await db.exec((await readFile(resolve(migrations, name), 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`); }
  count++;
}
for (const [id, role] of [['a2000000-0000-4000-8000-000000000001', 'admin'],
                           ['a2000000-0000-4000-8000-000000000002', 'cashier'],
                           ['a2000000-0000-4000-8000-000000000003', 'instructor']]) {
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `staging-${role}@example.test`]);
}
const sql = await readFile(resolve(import.meta.dirname, 'staging-seed.sql'), 'utf8');
await assert.rejects(db.exec(sql), /staging seed requires guarded runner/);
await db.exec("SELECT set_config('app.staging_seed_authorized','true',false)");
try { await db.exec(sql); await db.exec(sql); }
catch (error) { throw new Error(`Staging seed: ${error.message}`); }
const rows = await db.query(`SELECT
  (SELECT count(*) FROM public.customers WHERE id='a1000000-0000-4000-8000-000000000006') AS customers,
  (SELECT count(*) FROM public.club_memberships WHERE id='a1000000-0000-4000-8000-000000000004') AS memberships,
  (SELECT count(*) FROM public.club_session_roster WHERE session_id='a1000000-0000-4000-8000-000000000005') AS roster,
  (SELECT count(*) FROM public.sales) AS sales,
  (SELECT count(*) FROM public.hakafa_vouchers) AS vouchers`);
assert.deepEqual(rows.rows[0], { customers: 1, memberships: 1, roster: 1, sales: 0, vouchers: 0 });
const accountIds = {
  admin: 'a2000000-0000-4000-8000-000000000001',
  cashier: 'a2000000-0000-4000-8000-000000000002',
  instructor: 'a2000000-0000-4000-8000-000000000003',
};
for (const role of Object.keys(accountIds)) {
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('app.test_uid',$1,false)", [accountIds[role]]);
  const visible = await db.query('SELECT count(*)::int AS count FROM public.customers');
  assert.equal(visible.rows[0].count, role === 'instructor' ? 0 : 1);
  if (role === 'admin') {
    const mark = await db.query(`SELECT public.mark_club_attendance(
      'a1000000-0000-4000-8000-000000000005',
      'a1000000-0000-4000-8000-000000000004','present',0,'') AS result`);
    assert.equal(mark.rows[0].result.status, 'present');
    const history = await db.query(`SELECT public.get_club_attendance_history(
      'a1000000-0000-4000-8000-000000000002',current_date,current_date) AS result`);
    assert.equal(history.rows[0].result.length, 1);
    const manual = await db.query(`SELECT public.create_manual_club_session(
      'a1000000-0000-4000-8000-000000000002',current_date,'10:00','11:00',
      'a1000000-0000-4000-8000-000000000001','synthetic') AS id`);
    assert.ok(manual.rows[0].id);
  }
  if (role === 'instructor') {
    const sessions = await db.query('SELECT public.get_instructor_club_sessions(current_date,current_date) AS result');
    assert.equal(sessions.rows[0].result.linked, true);
    assert.ok(sessions.rows[0].result.sessions.some(session => session.id === 'a1000000-0000-4000-8000-000000000005'));
    const roster = await db.query("SELECT public.get_instructor_club_roster('a1000000-0000-4000-8000-000000000005') AS result");
    assert.equal(roster.rows[0].result.length, 1);
    const mark = await db.query(`SELECT public.mark_club_attendance(
      'a1000000-0000-4000-8000-000000000005',
      'a1000000-0000-4000-8000-000000000004','excused',1,'') AS result`);
    assert.equal(mark.rows[0].result.status, 'excused');
  } else if (role === 'cashier') {
    await assert.rejects(db.query('SELECT public.get_instructor_club_sessions(current_date,current_date)'), /attendance_forbidden/);
    await assert.rejects(db.query(`SELECT public.create_manual_club_session(
      'a1000000-0000-4000-8000-000000000002',current_date,'11:00','12:00',null,'')`), /admin_required/);
    await assert.rejects(db.query(`SELECT public.mark_club_attendance(
      'a1000000-0000-4000-8000-000000000005',
      'a1000000-0000-4000-8000-000000000004','absent',1,'')`), /attendance_forbidden/);
  }
  await db.exec('RESET ROLE');
}
console.log(`Staging seed rehearsal passed after ${count} migrations; idempotency and three-role SQL access passed`);
await db.close();
