// In-memory PostgreSQL only. No credentials or remote database connection.
// npm install --prefix .tmp/payment-db --save-exact @electric-sql/pglite@0.5.8
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../../', import.meta.url);
const dep = new URL('.tmp/payment-db/node_modules/@electric-sql/pglite/', root);
const { PGlite } = await import(new URL('dist/index.js', dep));
const { uuid_ossp } = await import(new URL('dist/contrib/uuid_ossp.js', dep));
const { pg_trgm } = await import(new URL('dist/contrib/pg_trgm.js', dep));
const db = new PGlite({ extensions: { uuid_ossp, pg_trgm } });
let stage = 'fixture';
try {
  await db.exec(await readFile(new URL('scripts/payments/fixture.sql', root), 'utf8'));
  const dir = new URL('supabase/migrations/', root);
  let legacy;
  for (const name of (await readdir(dir)).filter(n => /^\d{3}_.*\.sql$/.test(n)).sort()) {
    stage = name;
    if (name.startsWith('030_')) {
      await db.exec(`INSERT INTO orders(id,client_name,client_phone,activity_date,num_participants,price_per_person)
        VALUES ('39000000-0000-4000-8000-000000000001','Legacy fixture','',current_date,1,7);
        INSERT INTO sales(id,items,total,method) VALUES ('39000000-0000-4000-8000-000000000002','[]',7,'מזומן');`);
      legacy = (await db.query(`SELECT to_jsonb(o) AS row FROM orders o UNION ALL SELECT to_jsonb(s) FROM sales s`)).rows;
    }
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
    if (name.startsWith('030_')) {
      assert.deepEqual((await db.query(`SELECT to_jsonb(o) AS row FROM orders o UNION ALL SELECT to_jsonb(s) FROM sales s`)).rows, legacy);
      console.log('PASS pre-migration legacy order and sale preserved byte-for-byte');
    }
  }
  await db.exec(await readFile(new URL('scripts/payments/assertions.sql', root), 'utf8'));
  for (const name of ['pelecard_payment_ledger.sql', 'pelecard_payment_workflow.sql', 'profile_role_protection.sql', 'payment_accounting_orchestration.sql']) {
    stage = name;
    // Only replace the unavailable extension loader; preserve every assertion.
    const source = (await readFile(new URL(`supabase/tests/${name}`, root), 'utf8'))
      .replace('CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;', '');
    await db.exec(source);
    console.log(`PASS ${name} (local assertion compatibility harness)`);
  }
  stage = 'authoritative order payment assertions';
  await db.exec(`SELECT set_config('request.jwt.claim.role','service_role',false);
    INSERT INTO auth.users(id,email) VALUES ('30000000-0000-4000-8000-000000000001','payment@example.test');
    UPDATE public.profiles SET role='operations' WHERE id='30000000-0000-4000-8000-000000000001';
    INSERT INTO public.orders(id,client_name,client_phone,activity_date,num_participants,price_per_person)
    SELECT ('30000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'Synthetic','',current_date,2,60 FROM generate_series(2,5) i;`);
  const original = (await db.query("SELECT to_jsonb(o) AS row FROM orders o WHERE id::text LIKE '30000000%' ORDER BY id")).rows;
  const input = ['30000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001', 'order-attempt-1', 120, 'ILS', JSON.stringify({})];
  const reserve = (overrides = {}) => db.query('SELECT public.reserve_pelecard_order_payment($1,$2,$3,$4,$5,$6,$7) AS payment',
    input.map((v, i) => overrides[i] ?? v));
  await db.exec(`SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false);`);
  const reject = async (operation, expected) => {
    await assert.rejects(operation, error => error.message.includes(expected));
  };
  await reject(() => reserve({ 4: 1 }), 'order_amount_mismatch');
  await reject(() => reserve({ 5: 'USD' }), 'order_amount_mismatch');
  await reject(() => reserve({ 2: '30000000-0000-4000-8000-000000000099' }), 'order_payment_forbidden');
  await reject(() => reserve({ 1: '30000000-0000-4000-8000-000000000099' }), 'order_not_payable');
  const first = (await reserve()).rows[0].payment;
  assert.equal(first.amount, 120);
  assert.equal(first.checkout_snapshot.items[0].customPrice, 120);
  assert.equal(first.checkout_snapshot.linked_order_info.client_name, 'Synthetic');
  assert.equal((await reserve()).rows[0].payment.created, false);
  await reject(() => reserve({ 1: input[1].replace(/2$/, '5') }), 'idempotency_conflict');
  await reject(() => reserve({ 0: '30000000-0000-4000-8000-000000000011', 3: 'different-key' }), 'order_payment_in_progress');
  await db.query('SELECT public.mark_pelecard_initiation_uncertain($1,$2)', [input[0], 'provider_timeout']);
  await reject(() => reserve({ 3: 'after-timeout' }), 'order_payment_in_progress');
  await reject(() => db.query('UPDATE orders SET price_per_person=1 WHERE id=$1', [input[1]]), 'order_payment_in_progress');
  await reject(() => db.query("UPDATE orders SET status='בוטל' WHERE id=$1", [input[1]]), 'order_payment_in_progress');
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.role','authenticated',false); SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);`);
  await reject(() => reserve(), 'permission denied');
  await reject(() => db.query("UPDATE orders SET payment_status='מזומן' WHERE id=$1", [input[1]]), 'order_payment_in_progress');
  await db.exec(`RESET ROLE; SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false);`);
  const finalize = () => db.query('SELECT public.finalize_pelecard_payment($1,$2,$3,$4,$5,$6) AS payment',
    [input[0], 'synthetic-provider-id', 'synthetic-approval', '000', 120, 'ILS']);
  const paid = (await finalize()).rows[0].payment;
  assert.equal((await finalize()).rows[0].payment.sale_id, paid.sale_id);
  assert.equal(Number((await db.query('SELECT count(*) n FROM sales WHERE payment_transaction_id=$1', [input[0]])).rows[0].n), 1);
  await reject(() => reserve({ 3: 'already-paid' }), 'order_not_payable');
  await db.query("UPDATE orders SET payment_status='מזומן' WHERE id=$1", [input[1].replace(/2$/, '3')]);
  await reject(() => reserve({ 1: input[1].replace(/2$/, '3'), 3: 'manual-paid' }), 'order_not_payable');
  await db.query("UPDATE orders SET status='בוטל' WHERE id=$1", [input[1].replace(/2$/, '4')]);
  await reject(() => reserve({ 1: input[1].replace(/2$/, '4'), 3: 'cancelled' }), 'order_not_payable');
  assert.deepEqual((await db.query('SELECT to_jsonb(o) AS row FROM orders o WHERE id=$1', [input[1].replace(/2$/, '5')])).rows[0], original[3]);
  const failedId = '30000000-0000-4000-8000-000000000015';
  await reserve({ 0: failedId, 1: input[1].replace(/2$/, '5'), 3: 'decline-attempt' });
  await db.query('SELECT public.fail_pelecard_payment($1,$2,$3)', [failedId, '006', 'provider_declined']);
  assert.equal((await reserve({ 0: '30000000-0000-4000-8000-000000000016',
    1: input[1].replace(/2$/, '5'), 3: 'after-confirmed-decline' })).rows[0].payment.created, true);
  console.log('PASS migration chain, amount tampering, invalid/cancelled/manual-paid/already-paid orders, cross-key duplicate, timeout, order edit guard, authenticated RPC denial, atomic finalization, replay, untouched legacy order');
} catch (error) {
  console.error(`FAIL ${stage}; code=${error.code || 'assertion'}; message=${String(error.message).split('\n')[0]}`);
  process.exitCode = 1;
} finally { await db.close(); }
