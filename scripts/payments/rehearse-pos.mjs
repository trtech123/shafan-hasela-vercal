import { readFile, readdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

const project = resolve(import.meta.dirname, '../..');
const bin = process.env.POS_POSTGRES_BIN;
if (!bin) throw new Error('Set POS_POSTGRES_BIN to a disposable PostgreSQL bin directory');
const require = createRequire(join(project, 'app/package.json'));
const { Client } = require('pg');
const dir = await mkdtemp(join(tmpdir(), 'shafan-pos-pg-'));
const read = async path => readFile(join(project, path), 'utf8');
const run = (name, args) => execFileSync(join(bin, name + '.exe'), args,
  { windowsHide: true, timeout: 90000, stdio: 'ignore' });
const server = createServer();
await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
const port = server.address().port;
await new Promise(ok => server.close(ok));
let db, started = false;
try {
  run('initdb', ['-D', join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  run('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'),
    '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  started = true;
  db = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
  await db.connect();
  await db.query("SET statement_timeout='30s'");
  await db.query(await read('scripts/payments/fixture.sql'));
  await db.query(await read('scripts/payments/assertions.sql'));
  const migrations = (await readdir(join(project, 'supabase/migrations')))
    .filter(name => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    await db.query(await read('supabase/migrations/' + name));
    console.log('MIGRATION ' + name);
  }
  const suite = (await read('supabase/tests/pos_pelecard.sql'))
    .replace('CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;',
      '-- Local extension-compatible fail-fast assertion harness loaded above.');
  await db.query(suite);
  console.log('PASS 37/37 POS SQL assertions on disposable PostgreSQL; transaction rolled back');
} finally {
  if (db) await db.end();
  if (started) run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop']);
  console.log('Disposable database stopped: ' + dir);
}
