// Disposable in-memory PostgreSQL rehearsal. Never connects to production or a provider.
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const modulePath = resolve(root, 'app/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const extensions = join(dirname(modulePath), 'contrib');
const { uuid_ossp } = await import(pathToFileURL(join(extensions, 'uuid_ossp.js')).href);
const { pg_trgm } = await import(pathToFileURL(join(extensions, 'pg_trgm.js')).href);
const db = new PGlite({ extensions: { uuid_ossp, pg_trgm } });
const read = async path => (await readFile(join(root, path), 'utf8')).replace(/^\uFEFF/, '');
const operations = '94000000-0000-4000-8000-000000000011';
const instructor = '94000000-0000-4000-8000-000000000012';
const unknown = '94000000-0000-4000-8000-000000000013';
const order = '94000000-0000-4000-8000-000000000014';
try {
  await db.exec(await read('scripts/payments/fixture.sql'));
  await db.exec(await read('scripts/payments/assertions.sql'));
  const migrations = (await readdir(join(root, 'supabase/migrations')))
    .filter(name => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    try {
      await db.exec(await read(`supabase/migrations/${name}`));
      if (name === '001_schema.sql') await db.exec(`CREATE FUNCTION extensions.uuid_generate_v4()
        RETURNS uuid LANGUAGE sql AS $$ SELECT public.uuid_generate_v4() $$`);
    }
    catch (error) { throw new Error(`migration ${name}: ${error.message}`); }
  }
  await db.exec(`
    SELECT set_config('request.jwt.claim.role','service_role',false);
    INSERT INTO auth.users(id,email) VALUES
      ('${operations}','operations@example.test'),('${instructor}','instructor@example.test');
    UPDATE public.profiles SET role='operations' WHERE id='${operations}';
    UPDATE public.profiles SET role='instructor' WHERE id='${instructor}';
    UPDATE public.physical_terminal_devices SET enabled=true,cash_register_code='GENERAL'
      WHERE register_number='004';
  `);
  for (const actor of [operations, instructor]) {
    const billing = { kind: 'person', name: 'Synthetic Customer',
      identity: '123456782', email: 'synthetic@example.test', vatApplicable: true };
    const snapshot = { items: [{ id: order, name: 'Synthetic ticket', qty: 1,
      customPrice: 15 }], discount: null };
    const key = actor === operations
      ? '94000000-0000-4000-8000-000000000021'
      : '94000000-0000-4000-8000-000000000022';
    const reserved = (await db.query(`SELECT public.reserve_physical_payment(
      $1::uuid,$2::uuid,'GENERAL',1500,$3::jsonb,$4::jsonb) AS result`,
    [actor, key, snapshot, billing])).rows[0].result;
    assert.equal(reserved.registerNumber, '004');
    assert.equal((await db.query(`SELECT public.cancel_physical_reserved($1::uuid,$2::uuid) AS result`,
      [actor, key])).rows[0].result, true);
    assert.equal((await db.query(`SELECT public.get_payper_billing_defaults($1::uuid,$2::uuid) AS result`,
      [order, actor])).rows[0].result, null);
    assert.deepEqual((await db.query(`SELECT public.digital_order_payment_issues(
      $1::uuid,$2::uuid,'{}'::jsonb) AS result`, [order, actor])).rows[0].result,
    ['order_not_found']);
    await assert.rejects(db.query(`SELECT public.get_payper_order_collection($1::uuid,$2::uuid)`,
      [actor, order]), /order_not_found/);
    await assert.rejects(db.query(`SELECT public.reserve_physical_order_payment(
      $1::uuid,$2::uuid,'GENERAL',$3::uuid,1500)`,
    [actor, '94000000-0000-4000-8000-000000000023', order]), /physical_order_not_payable/);
  }
  await assert.rejects(db.query(`SELECT public.get_payper_order_collection($1::uuid,$2::uuid)`,
    [unknown, order]), /order_collection_forbidden/);
  console.log(`PASS ${migrations.length} migrations; operations and instructor physical reservations, read-only order status, missing-profile denial`);
} catch (error) {
  console.error(`FAIL physical role rehearsal: ${error.message}`);
  process.exitCode = 1;
} finally { await db.close(); }
