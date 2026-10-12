// Isolated in-memory PostgreSQL. Never reads environment credentials or connects remotely.
// Usage: node scripts/chatbot/test-document-migration.mjs <directory containing node_modules/@electric-sql/pglite>
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(resolve(process.argv[2], "package.json"));
const { PGlite } = require("@electric-sql/pglite");
const { uuid_ossp } = require("@electric-sql/pglite/contrib/uuid_ossp");
const { pg_trgm } = require("@electric-sql/pglite/contrib/pg_trgm");
const db = new PGlite({ extensions: { uuid_ossp, pg_trgm } });
const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");
await db.exec(await read("scripts/payments/fixture.sql"));
await db.exec(await read("scripts/payments/assertions.sql"));
const migrationNames = (await readdir(new URL("../../supabase/migrations/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort();
assert.equal(new Set(migrationNames.map((name) => name.split("_")[0])).size, migrationNames.length, "migration identifiers must be unique");
for (const name of migrationNames) {
  if (name === "046_quotation_lifecycle.sql") await db.exec(`INSERT INTO public.quotes(id,client_name,client_phone,event_date,num_participants,selected_activities,total_price,discount,final_price)
    VALUES ('96000000-0000-4000-8000-000000000090','Synthetic migration fixture','0500000000','2026-11-01',10,'[{"activity_name":"Historical legacy","price_per_person":5}]',50,0,50)`);
  await db.exec(await read(`supabase/migrations/${name}`));
}
// Standard Supabase object grants; the actual migration policies still govern access.
await db.exec("GRANT ALL ON storage.objects TO anon, authenticated, service_role");
assert.equal((await db.query("SELECT to_regprocedure('public.uuid_generate_v4()') AS fn")).rows[0].fn, null);
let checks = 0;
async function fixture({ status = "automated", age = "1 minute" } = {}) {
  const { rows: [contact] } = await db.query(`INSERT INTO bot_contacts(channel,external_contact_id,verification_source,verified_at) VALUES('whatsapp',gen_random_uuid()::text,'meta_whatsapp_signed_webhook',now()) RETURNING id`);
  const { rows: [conversation] } = await db.query(`INSERT INTO bot_conversations(contact_id,channel,thread_id,content_version,status) VALUES($1,'whatsapp',gen_random_uuid()::text,'test',$2) RETURNING id`, [contact.id, status]);
  const { rows: [event] } = await db.query(`INSERT INTO bot_channel_events(channel,provider_event_id,event_kind,payload_digest,occurred_at) VALUES('whatsapp',gen_random_uuid()::text,'message',repeat('a',64),now()-$1::interval) RETURNING id`, [age]);
  const { rows: [message] } = await db.query(`INSERT INTO bot_messages(conversation_id,trigger_event_id,channel,direction,message_kind,delivery_status,asset_id,asset_checksum,occurred_at) VALUES($1,$2,'whatsapp','outbound','attachment','pending','carmel',repeat('a',64),now()) RETURNING id`, [conversation.id,event.id]);
  return { message, event, conversation };
}
async function claim(id) { return (await db.query(`SELECT claim_bot_attachment($1) AS claimed`, [id])).rows[0].claimed; }
const fresh = await fixture();
assert.equal(await claim(fresh.message.id), 'claimed'); checks++;
assert.equal(await claim(fresh.message.id), 'unavailable'); checks++;
for (const status of ['awaiting_human','human_active','resolved','closed']) { assert.equal(await claim((await fixture({status})).message.id), 'locked'); checks++; }
assert.equal(await claim((await fixture({age:'24 hours'})).message.id), 'expired'); checks++;
const concurrent = await fixture();
assert.deepEqual((await Promise.all([claim(concurrent.message.id),claim(concurrent.message.id)])).sort(), ['claimed','unavailable']); checks++;
await db.exec(`SET ROLE authenticated`);
await assert.rejects(claim(fresh.message.id), /permission denied/); checks++;
await db.exec(`RESET ROLE; INSERT INTO storage.objects(bucket_id,name) VALUES('chatbot-assets','private.pdf'); SET ROLE anon;`);
assert.equal((await db.query(`SELECT * FROM storage.objects`)).rows.length, 0); checks++;
await db.exec(`RESET ROLE; SET ROLE authenticated;`);
assert.equal((await db.query(`SELECT * FROM storage.objects`)).rows.length, 0); checks++;
await db.exec(`RESET ROLE`);
assert.equal((await db.query(`SELECT public FROM storage.buckets WHERE id='chatbot-assets'`)).rows[0].public, false); checks++;
assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.leads`)).rows[0].n, 0); checks++;
// Attachment failures/uncertainty must not enter the existing text-only replay branch.
for (const code of ['attachment_failed','attachment_uncertain','attachment_expired']) {
  const f = await fixture();
  await db.query(`UPDATE bot_channel_events SET processing_status='failed',error_code=$1 WHERE id=$2`, [code, f.event.id]);
  const { rows: [event] } = await db.query(`SELECT * FROM bot_channel_events WHERE id=$1`, [f.event.id]);
  const result = await db.query(`SELECT * FROM claim_bot_channel_event('whatsapp',$1,NULL,'message',repeat('a',64),now(),'{}')`, [event.provider_event_id]);
  assert.equal(result.rows[0].claimed, false); checks++;
}
const serviceFixture = await fixture();
await db.exec(`SET ROLE service_role`);
assert.equal(await claim(serviceFixture.message.id), 'claimed'); checks++;
await db.exec(`RESET ROLE`);
await assert.rejects(db.query(`INSERT INTO bot_messages(conversation_id,trigger_event_id,channel,direction,message_kind,asset_id,asset_checksum,occurred_at) VALUES($1,$2,'whatsapp','outbound','attachment','carmel',repeat('a',64),now())`, [fresh.conversation.id,fresh.event.id]), /duplicate key/); checks++;
await db.close();
console.log(`${checks} isolated PostgreSQL document checks passed after ${migrationNames.length} canonical migrations. UUID extension layout preserved. No remote database accessed.`);
