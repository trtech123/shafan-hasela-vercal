import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';

const db = new PGlite();
const migration = new URL('../../supabase/migrations/202611150005_landing_lead_ingestion.sql', import.meta.url);
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      'SELECT current_setting(''app.test_role'',true)';
    CREATE TABLE public.leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text NOT NULL,
      phone text, email text, company text, site text, event_date date,
      source_text text, notes text,
      status text NOT NULL DEFAULT 'פתוח', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.bot_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_name text, phone text, email text
    );
    CREATE TABLE public.bot_conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid REFERENCES public.bot_contacts(id),
      selected_site text, selected_activity text,
      collected_fields jsonb DEFAULT '{}'::jsonb, status text DEFAULT 'automated'
    );
    CREATE TABLE public.bot_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid,
      direction text, body text, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.bot_handoffs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid, lead_id uuid REFERENCES public.leads(id),
      status text DEFAULT 'waiting', reason text, priority text, summary text, customer_name text,
      callback_phone text, callback_email text, company text, requested_site text,
      requested_activity text, group_size text, preferred_date text
    );
    SELECT set_config('app.test_role','service_role',false);
  `);
  await db.exec(await readFile(migration, 'utf8'));
  const base = { fullName: 'Synthetic Customer', phone: '0501234567',
    email: 'synthetic@example.invalid', company: null, inquiry: 'Group activity',
    source: 'landing_page', attribution: { pagePath: '/he/',
      pageUrl: 'https://www.shafan-hasela.com/he/', utmSource: 'search' } };
  const args = ['10db6ba', 'a'.repeat(64), 'b'.repeat(64), JSON.stringify(base)];
  const first = (await db.query('SELECT public.ingest_landing_lead($1,$2,$3,$4::jsonb) AS result', args)).rows[0].result;
  assert.equal(first.created, true);
  const duplicate = (await db.query('SELECT public.ingest_landing_lead($1,$2,$3,$4::jsonb) AS result', args)).rows[0].result;
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.leadId, first.leadId);
  for (const key of ['c', 'd']) {
    const result = (await db.query('SELECT public.ingest_landing_lead($1,$2,$3,$4::jsonb) AS result',
      ['10db6ba', key.repeat(64), 'b'.repeat(64), JSON.stringify({ ...base, inquiry: key })])).rows[0].result;
    assert.equal(result.created, true);
  }
  const limited = (await db.query('SELECT public.ingest_landing_lead($1,$2,$3,$4::jsonb) AS result',
    ['10db6ba', 'e'.repeat(64), 'b'.repeat(64), JSON.stringify(base)])).rows[0].result;
  assert.equal(limited.limited, true);
  const rows = (await db.query('SELECT id,lead_source,lead_attribution,source_text FROM public.leads')).rows;
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.lead_source === 'landing_page'));
  assert.equal(rows[0].lead_attribution.utmSource, 'search');
  assert.equal(rows[0].source_text, 'Group activity');
  const base44 = { ...base, email: null,
    attribution: { pagePath: '/', pageUrl: 'https://vegan-climb-the-summit.base44.app/',
      sourceLabel: 'דף נחיתה — יום גיבוש', topic: 'יום גיבוש לחברות' } };
  const phoneOnly = (await db.query('SELECT public.ingest_landing_lead($1,$2,$3,$4::jsonb) AS result',
    ['nurit-team-building', 'f'.repeat(64), 'c'.repeat(64), JSON.stringify(base44)])).rows[0].result;
  assert.equal(phoneOnly.created, true);
  const stored = (await db.query('SELECT email,status,lead_attribution FROM public.leads WHERE id=$1',
    [phoneOnly.leadId])).rows[0];
  assert.equal(stored.email, null);
  assert.equal(stored.status, 'פתוח');
  assert.equal(stored.lead_attribution.topic, 'יום גיבוש לחברות');
  const contact = (await db.query("INSERT INTO public.bot_contacts(display_name,phone) VALUES ('Synthetic Customer','0501234567') RETURNING id")).rows[0];
  const conversation = (await db.query('INSERT INTO public.bot_conversations(contact_id) VALUES ($1) RETURNING id',
    [contact.id])).rows[0];
  await db.query("INSERT INTO public.bot_messages(conversation_id,direction,body) VALUES ($1,'inbound',$2)",
    [conversation.id, `Please contact me #SHF-${'f'.repeat(64)}`]);
  const handoff = (await db.query('SELECT * FROM public.create_bot_handoff($1,$2,$3,$4,$5::jsonb)',
    [conversation.id, 'requested_agent', 'normal', 'Synthetic handoff', '{}'])).rows[0];
  assert.equal(handoff.lead_id, phoneOnly.leadId);
  const linked = (await db.query('SELECT lead_id FROM public.bot_handoffs WHERE id=$1', [handoff.handoff_id])).rows[0];
  assert.equal(linked.lead_id, phoneOnly.leadId);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.leads')).rows[0].n, 4);
  const otherConversation = (await db.query('INSERT INTO public.bot_conversations(contact_id) VALUES ($1) RETURNING id',
    [contact.id])).rows[0];
  const ordinary = (await db.query('SELECT * FROM public.create_bot_handoff($1,$2,$3,$4,$5::jsonb)',
    [otherConversation.id, 'requested_agent', 'normal', 'Ordinary handoff', '{}'])).rows[0];
  assert.notEqual(ordinary.lead_id, phoneOnly.leadId);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.leads')).rows[0].n, 5);
  const otherContact = (await db.query("INSERT INTO public.bot_contacts(display_name,phone) VALUES ('Other Synthetic','0507654321') RETURNING id")).rows[0];
  const wrongSender = (await db.query('INSERT INTO public.bot_conversations(contact_id) VALUES ($1) RETURNING id',
    [otherContact.id])).rows[0];
  await db.query("INSERT INTO public.bot_messages(conversation_id,direction,body) VALUES ($1,'inbound',$2)",
    [wrongSender.id, `Forwarded #SHF-${'f'.repeat(64)}`]);
  const unrelated = (await db.query('SELECT * FROM public.create_bot_handoff($1,$2,$3,$4,$5::jsonb)',
    [wrongSender.id, 'requested_agent', 'normal', 'Different sender', '{}'])).rows[0];
  assert.notEqual(unrelated.lead_id, phoneOnly.leadId);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.leads')).rows[0].n, 6);
  await db.query("SELECT set_config('app.test_role','authenticated',false)");
  await assert.rejects(db.query('SELECT public.ingest_landing_lead($1,$2,$3,$4::jsonb)',
    ['10db6ba', 'f'.repeat(64), 'b'.repeat(64), JSON.stringify(base)]), /permission|forbidden/i);
  console.log(JSON.stringify({ leads: rows.length + 1, duplicate: 'blocked', rateLimit: 'passed',
    source: 'landing_page', unauthorized: 'blocked' }));
} finally {
  await db.close();
}
