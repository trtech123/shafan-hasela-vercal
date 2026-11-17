// In-memory only: reproduce the exact order/intent shape without contacting a provider.
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
const payment = 'ab3c6849-a4ad-476f-a615-22e04287ddbf';
const order = '05db5353-64ff-403d-a704-198ea9568729';
const actor = '94000000-0000-4000-8000-000000000011';
const reference = `Pelecard support phone call 2026-11-17 16:45 Israel: no charge, no Payper document; ${payment} permanently closed and cannot settle`;
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
    } catch (error) { throw new Error(`migration ${name}: ${error.message}`); }
  }
  await db.exec(`
    SELECT set_config('request.jwt.claim.role','service_role',false);
    INSERT INTO auth.users(id,email) VALUES ('${actor}','cashier@example.test');
    UPDATE public.profiles SET role='cashier' WHERE id='${actor}';
    INSERT INTO public.orders(id,order_number,client_name,client_phone,activity_date,
      num_participants,total_price,status,payment_status)
    VALUES('${order}','ORD-1060','Synthetic Customer','0000000000','2026-11-17',
      1,15.00,'מאושר','לא שולם');
    INSERT INTO public.payment_transactions(id,provider,operation,order_id,amount,
      currency,status,idempotency_key,checkout_snapshot,created_by)
    VALUES('${payment}','pelecard','payment','${order}',15.00,'ILS','initiated',
      'physical-${payment}','{}'::jsonb,'${actor}');
    INSERT INTO public.physical_payment_intents(payment_id,request_key,created_by,
      workstation_code,register_number,terminal_number,amount_minor,
      checkout_snapshot,billing_snapshot,state,dispatch_started_at,route)
    VALUES('${payment}','94000000-0000-4000-8000-000000000021','${actor}',
      'GENERAL','004','2814926015',1500,'{}'::jsonb,
      '{"kind":"person","name":"Synthetic Customer","identity":"123456782","email":"synthetic@example.test","vatApplicable":true}'::jsonb,
      'uncertain','2026-11-17 13:26:26+00','direct');
  `);
  const close = async (noDocument = true) => db.query(`SELECT public.close_ord1060_direct_j4_confirmed_unpaid(
    $1::uuid,'provider_phone_confirmation',DATE '2026-11-17',$2::text,true,$3::boolean,true) AS result`,
  [payment, reference, noDocument]);
  await assert.rejects(close(false), /physical_direct_confirmation_required/);
  assert.equal((await db.query(`SELECT state FROM public.physical_payment_intents WHERE payment_id=$1`,
    [payment])).rows[0].state, 'uncertain');
  await db.exec(`SELECT set_config('request.jwt.claim.role','authenticated',false)`);
  await assert.rejects(close(), /service_role_required/);
  await db.exec(`SELECT set_config('request.jwt.claim.role','service_role',false)`);
  assert.equal((await close()).rows[0].result.state, 'canceled');
  assert.equal((await close()).rows[0].result.paymentStatus, 'expired');
  const result = (await db.query(`SELECT i.state,p.status,o.payment_status,
    (SELECT count(*)::int FROM public.physical_direct_unpaid_confirmations) AS confirmations,
    (SELECT count(*)::int FROM public.sales WHERE order_id=o.id) AS sales
    FROM public.physical_payment_intents i JOIN public.payment_transactions p ON p.id=i.payment_id
    JOIN public.orders o ON o.id=p.order_id WHERE i.payment_id=$1`, [payment])).rows[0];
  assert.deepEqual(result, { state: 'canceled', status: 'expired',
    payment_status: 'לא שולם', confirmations: 1, sales: 0 });
  console.log(`PASS ${migrations.length} migrations; guarded direct J4 closure, idempotency, role denial and unchanged order`);
} catch (error) {
  console.error(`FAIL direct J4 closure rehearsal: ${error.message}`);
  process.exitCode = 1;
} finally { await db.close(); }
