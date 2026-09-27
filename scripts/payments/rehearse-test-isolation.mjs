// Native disposable PostgreSQL, loopback only. No production connection/secrets.
// npm install --prefix .tmp/pelecard/sql-runtime embedded-postgres@18.4.0-beta.17
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = new URL('../../', import.meta.url);
const { default: EmbeddedPostgres } = await import(new URL('.tmp/pelecard/sql-runtime/node_modules/embedded-postgres/dist/index.js', root));
const pg = new EmbeddedPostgres({
  databaseDir: fileURLToPath(new URL(`.tmp/pelecard/pg-${randomUUID()}`, root)),
  user: 'postgres', password: randomUUID(), port: 55439, persistent: true,
  initdbFlags: ['--encoding=UTF8'],
  postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {},
});
let client;
let stage = 'initialization';
let failed = false;
try {
  await pg.initialise(); await pg.start();
  client = pg.getPgClient(); await client.connect();
  await client.query(await readFile(new URL('scripts/payments/fixture.sql', root), 'utf8'));
  const dir = new URL('supabase/migrations/', root);
  for (const name of (await readdir(dir)).filter(n => /^\d{3}_.*\.sql$/.test(n)).sort()) {
    stage = name;
    await client.query(await readFile(new URL(name, dir), 'utf8'));
  }
  // Existing assertion compatibility functions run each unmodified assertion
  // on native PostgreSQL; only pgTAP's unavailable CREATE EXTENSION is removed.
  await client.query(await readFile(new URL('scripts/payments/assertions.sql', root), 'utf8'));
  for (const name of ['pelecard_payment_ledger.sql','pelecard_payment_workflow.sql','profile_role_protection.sql','payment_accounting_orchestration.sql','pelecard_test_isolation.sql']) {
    stage = name;
    const sql = (await readFile(new URL(`supabase/tests/${name}`, root),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;', '');
    await client.query(sql);
    console.log(`PASS ${name} (native PostgreSQL, assertion compatibility harness)`);
  }
} catch (error) {
  console.error(`FAIL ${stage}: ${error.message}`); failed = true;
} finally { if (client) await client.end(); await pg.stop(); }
process.exit(failed ? 1 : 0);
