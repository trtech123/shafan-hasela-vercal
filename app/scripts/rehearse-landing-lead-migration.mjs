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
      phone text, email text, company text, source_text text, notes text,
      status text NOT NULL DEFAULT 'פתוח', created_at timestamptz NOT NULL DEFAULT now()
    );
    SELECT set_config('app.test_role','service_role',false);
  `);
  await db.exec(await readFile(migration, 'utf8'));
  const base = { fullName: 'Synthetic Customer', phone: '0501234567',
    email: 'synthetic@example.invalid', company: null, inquiry: 'Group activity',
    source: 'landing_page', attribution: { pagePath: '/he/', utmSource: 'search' } };
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
  await db.query("SELECT set_config('app.test_role','authenticated',false)");
  await assert.rejects(db.query('SELECT public.ingest_landing_lead($1,$2,$3,$4::jsonb)',
    ['10db6ba', 'f'.repeat(64), 'b'.repeat(64), JSON.stringify(base)]), /permission|forbidden/i);
  console.log(JSON.stringify({ leads: rows.length, duplicate: 'blocked', rateLimit: 'passed',
    source: 'landing_page', unauthorized: 'blocked' }));
} finally {
  await db.close();
}
