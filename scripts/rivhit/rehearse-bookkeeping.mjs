// Disposable loopback PostgreSQL only. Never uses Supabase or Rivhit credentials.
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const { default: EmbeddedPostgres } = await import(new URL(
  '../../../../.tmp/pelecard/sql-runtime/node_modules/embedded-postgres/dist/index.js', import.meta.url));
const databaseDir = join(tmpdir(), `shafan-rivhit-bookkeeping-${randomUUID()}`);
const pg = new EmbeddedPostgres({
  databaseDir, user: 'postgres', password: randomUUID(),
  port: 57000 + Math.floor(Math.random() * 1000), persistent: false,
  initdbFlags: ['--encoding=UTF8'], postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {}, onError: () => {},
});
let client;
let stage = 'initialization';
try {
  await pg.initialise(); await pg.start();
  client = pg.getPgClient(); await client.connect();
  await client.query(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA extensions;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'role' $$;
    GRANT USAGE ON SCHEMA auth,extensions,public TO service_role,authenticated,anon;
    GRANT EXECUTE ON FUNCTION auth.role() TO service_role;
  `);
  stage = 'migration';
  await client.query(await readFile(new URL('../../supabase/migrations/202611150001_rivhit_bookkeeping_sync.sql', import.meta.url), 'utf8'));
  stage = 'SQL assertions';
  const harness = await readFile(new URL('../../scripts/payments/assertions.sql', import.meta.url), 'utf8');
  await client.query(harness.replace('CREATE SCHEMA IF NOT EXISTS extensions;', ''));
  const sql = await readFile(new URL('../../supabase/tests/rivhit_bookkeeping_sync.sql', import.meta.url), 'utf8');
  await client.query(sql.replace('CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;', ''));
  console.log('PASS migration and 9 SQL assertions on native PostgreSQL');

  stage = 'parallel claim';
  await client.query(`
    SET ROLE service_role;
    SET request.jwt.claims = '{"role":"service_role"}';
    INSERT INTO public.rivhit_bookkeeping_sources
      (id,account_namespace,source_system,source_document_id,document_number,
       document_type,payment_id,issued_at,gross_minor,currency,source_snapshot,source_hash)
    VALUES ('71500000-0000-4000-8000-000000000011','test-account','payper',
      'payper-200002','200002','invoice_receipt',
      '71500000-0000-4000-8000-000000000012',now(),400,'ILS','{}',repeat('a',64));
    INSERT INTO public.rivhit_bookkeeping_legs
      (id,source_id,leg_kind,request_reference,status,mapping_version,
       mapping_approval_ref,frozen_request,request_hash)
    VALUES
      ('71500000-0000-4000-8000-000000000013',
       '71500000-0000-4000-8000-000000000011','invoice','test:200002:invoice',
       'ready','v1','accountant','{"amount":4}',repeat('b',64)),
      ('71500000-0000-4000-8000-000000000014',
       '71500000-0000-4000-8000-000000000011','receipt','test:200002:receipt',
       'ready','v1','accountant','{"amount":4}',repeat('c',64));
  `);
  assert.equal((await client.query(
    "SELECT count(*)::integer AS n FROM public.claim_rivhit_bookkeeping_leg($1,'v1','accountant','test-account')",
    ['71500000-0000-4000-8000-000000000014'])).rows[0].n, 0);
  console.log('PASS receipt leg waits for successful invoice leg');
  const contenders = Array.from({ length: 8 }, () => pg.getPgClient());
  try {
    await Promise.all(contenders.map(async c => {
      await c.connect();
      await c.query(`SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}'`);
    }));
    const claims = await Promise.all(contenders.map(c => c.query(
      "SELECT * FROM public.claim_rivhit_bookkeeping_leg($1,'v1','accountant','test-account')",
      ['71500000-0000-4000-8000-000000000013'])));
    assert.equal(claims.reduce((n, result) => n + result.rowCount, 0), 1);
    const winner = claims.flatMap(result => result.rows)[0];
    assert.equal((await client.query(
      'SELECT public.complete_rivhit_bookkeeping_leg($1,$2,2026,11,42) AS ok',
      [winner.leg_id, winner.claim_token])).rows[0].ok, true);
    assert.equal((await client.query(
      "SELECT count(*)::integer AS n FROM public.claim_rivhit_bookkeeping_leg($1,'v1','accountant','test-account')",
      [winner.leg_id])).rows[0].n, 0);
    console.log('PASS 8 concurrent workers: one claim and one completed journal');
  } finally { await Promise.all(contenders.map(c => c.end())); }

  stage = 'split invoice/receipt outcome';
  const second = (await client.query(
    "SELECT * FROM public.claim_rivhit_bookkeeping_leg($1,'v1','accountant','test-account')",
    ['71500000-0000-4000-8000-000000000014'])).rows[0];
  assert.equal((await client.query(
    "SELECT public.hold_rivhit_bookkeeping_leg($1,$2,'unknown_outcome') AS ok",
    [second.leg_id, second.claim_token])).rows[0].ok, true);
  const states = (await client.query(`SELECT leg_kind,status FROM public.rivhit_bookkeeping_legs
    WHERE source_id='71500000-0000-4000-8000-000000000011' ORDER BY leg_kind`)).rows;
  assert.deepEqual(states, [
    { leg_kind: 'invoice', status: 'succeeded' },
    { leg_kind: 'receipt', status: 'reconciliation_required' },
  ]);
  assert.equal((await client.query(
    "SELECT count(*)::integer AS n FROM public.claim_rivhit_bookkeeping_leg($1,'v1','accountant','test-account')",
    [second.leg_id])).rows[0].n, 0);
  console.log('PASS invoice succeeded, receipt uncertain: held without automatic retry');
} catch (error) {
  console.error(`FAIL ${stage}: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (client) await client.end();
  if (pg.process?.pid) spawnSync('taskkill', ['/PID', String(pg.process.pid), '/T', '/F'], { timeout: 5000 });
  const target = resolve(databaseDir);
  if (target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('shafan-rivhit-bookkeeping-'))
    await rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
}
process.exit(process.exitCode ?? 0);
