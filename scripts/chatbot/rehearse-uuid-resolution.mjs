// Disposable, in-memory PostgreSQL only. No production connection or provider calls.
// PGLITE_PACKAGE_DIR may point to an existing @electric-sql/pglite installation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const packageDir = process.env.PGLITE_PACKAGE_DIR
  || path.join(root, '.tmp/payment-db/node_modules/@electric-sql/pglite');
const load = (file) => import(pathToFileURL(path.join(packageDir, file)).href);
const { PGlite } = await load('dist/index.js');
const { uuid_ossp } = await load('dist/contrib/uuid_ossp.js');
const { pg_trgm } = await load('dist/contrib/pg_trgm.js');
const db = new PGlite({ extensions: { uuid_ossp, pg_trgm } });
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const claim = async (key = 'disposable-uuid-test') => one(`
  SELECT * FROM public.claim_bot_channel_event(
    'whatsapp', $1, $1, 'message', repeat('a',64), now(), '{}'::jsonb
  )`, [key]);
const uuid = (value) => assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

try {
  await db.exec(read('scripts/payments/fixture.sql'));
  await db.exec(read('scripts/payments/assertions.sql'));
  const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    if (process.argv.includes('--before-fix') && file === '202610090001_chatbot_uuid_resolution.sql') continue;
    if (file === '046_quotation_lifecycle.sql') await db.exec(`INSERT INTO public.quotes(id,client_name,client_phone,event_date,num_participants,selected_activities,total_price,discount,final_price)
      VALUES ('96000000-0000-4000-8000-000000000090','Pre-migration legacy','0500000000','2026-11-01',10,'[{"activity_name":"Historical legacy","price_per_person":5}]',50,0,50)`);
    await db.exec(read(`supabase/migrations/${file}`));
  }
  // Match production: no public UUID shim and no extensions in the RPC search_path.
  assert.equal((await one("SELECT to_regprocedure('public.uuid_generate_v4()') AS fn")).fn, null);
  await db.exec('SET ROLE service_role; SET search_path=public,pg_temp');
  const first = await claim(); // Before the fix: exact production SQLSTATE 42883.
  uuid(first.event_id);
  assert.equal(first.claimed, true);
  assert.equal(first.resumed, false);
  console.log('PASS first claim and UUID generation under service_role');

  const duplicate = await claim();
  assert.deepEqual(duplicate, { event_id: first.event_id, claimed: false, resumed: false });
  await db.query("UPDATE bot_channel_events SET processing_status='completed' WHERE id=$1", [first.event_id]);
  assert.deepEqual(await claim(), duplicate);
  await db.query("UPDATE bot_channel_events SET processing_status='failed',error_code='send_failed',retry_after=now()+interval '1 hour' WHERE id=$1", [first.event_id]);
  assert.deepEqual(await claim(), duplicate);
  await db.query("UPDATE bot_channel_events SET retry_after=now()-interval '1 second' WHERE id=$1", [first.event_id]);
  assert.deepEqual(await claim(), { event_id: first.event_id, claimed: true, resumed: true });
  assert.equal((await one('SELECT retry_count FROM bot_channel_events WHERE id=$1', [first.event_id])).retry_count, 1);
  assert.deepEqual(await claim(), duplicate);
  await db.query("UPDATE bot_channel_events SET processing_status='failed',error_code='processing_failed' WHERE id=$1", [first.event_id]);
  assert.deepEqual(await claim(), duplicate);
  assert.equal((await one('SELECT count(*)::int AS n FROM bot_channel_events')).n, 1);
  const second = await claim('disposable-uuid-test-2');
  uuid(second.event_id);
  assert.notEqual(second.event_id, first.event_id);
  console.log('PASS duplicate, completed replay, delayed retry, send retry, non-retryable failure and distinct UUIDs');

  // Exercise all bot table defaults, update triggers and handoff/lead RPC defaults
  // with extensions excluded from the caller's search_path too.
  const contact = await one(`INSERT INTO bot_contacts(channel,external_contact_id,verification_source,verified_at)
    VALUES ('whatsapp','disposable-contact','meta_signature',now()) RETURNING id`);
  const conversation = await one(`INSERT INTO bot_conversations(contact_id,channel,thread_id,content_version)
    VALUES ($1,'whatsapp','disposable-thread','v1') RETURNING id`, [contact.id]);
  const message = await one(`INSERT INTO bot_messages(conversation_id,trigger_event_id,channel,direction,message_kind,occurred_at)
    VALUES ($1,$2,'whatsapp','inbound','text',now()) RETURNING id`, [conversation.id, first.event_id]);
  const action = await one(`INSERT INTO bot_action_events(conversation_id,trigger_event_id,action_id,idempotency_key,availability,outcome,failure_code)
    VALUES ($1,$2,'resend_order_confirmation','disposable-action','handoff_only','handoff_required','artifact_persistence_unavailable') RETURNING id`, [conversation.id, first.event_id]);
  const handoffSql = "SELECT * FROM create_bot_handoff($1,'customer_request','normal','Disposable test','{}'::jsonb)";
  const handoff = await one(handoffSql, [conversation.id]);
  assert.deepEqual(await one(handoffSql, [conversation.id]), handoff);
  const directEvent = await one(`INSERT INTO bot_channel_events(channel,provider_event_id,event_kind,payload_digest,occurred_at)
    VALUES ('whatsapp','disposable-default','message',repeat('b',64),now()) RETURNING id`);
  for (const id of [contact.id, conversation.id, message.id, action.id, handoff.handoff_id, handoff.lead_id, directEvent.id]) uuid(id);
  await db.query('UPDATE bot_contacts SET display_name=$1 WHERE id=$2', ['Disposable', contact.id]);
  await db.query("UPDATE bot_handoffs SET summary='Disposable updated' WHERE id=$1", [handoff.handoff_id]);
  console.log('PASS six bot defaults, lead default, handoff idempotency and update triggers');

  await db.exec('RESET ROLE');
  const permissions = await one(`SELECT
    has_function_privilege('anon','public.claim_bot_channel_event(text,text,text,text,text,timestamptz,jsonb)','EXECUTE') anon,
    has_function_privilege('authenticated','public.claim_bot_channel_event(text,text,text,text,text,timestamptz,jsonb)','EXECUTE') authenticated,
    has_function_privilege('service_role','public.claim_bot_channel_event(text,text,text,text,text,timestamptz,jsonb)','EXECUTE') service_role,
    p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid='public.claim_bot_channel_event(text,text,text,text,text,timestamptz,jsonb)'::regprocedure`);
  assert.deepEqual(permissions, { anon: false, authenticated: false, service_role: true, prosecdef: true, proconfig: ['search_path=public, pg_temp'] });
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(claim, (error) => error.code === '42501');
    await db.exec('RESET ROLE');
  }
  console.log('PASS unchanged RPC authorization and restricted search_path');

  for (const file of ['quotation_lifecycle.sql', 'order_confirmation_delivery.sql', 'delivery_acceptance.sql']) {
    await db.exec(read(`supabase/tests/${file}`));
    console.log(`PASS existing DB regression ${file}`);
  }
  console.log(`PASS disposable database rehearsal (${migrations.length} migrations); no network/provider calls`);
} catch (error) {
  console.error('FAIL', error.code || '', error.message, error.where || '');
  process.exitCode = 1;
} finally {
  await db.close();
}
