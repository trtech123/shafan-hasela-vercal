import { readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const directory = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const optional = process.argv.slice(2).filter(arg => arg.endsWith('.sql')).map(arg => resolve(arg));
const db = new PGlite({ extensions: { 'uuid-ossp': uuid_ossp, pg_trgm } });
let current = 'Supabase bootstrap';
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''app.test_uid'',true),'''')::uuid';
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      'SELECT current_setting(''app.test_role'',true)';
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    SELECT set_config('app.test_role','service_role',false);
  `);
  const files = (await readdir(directory)).filter(name => name.endsWith('.sql'));
  const migrations = [...files.map(name => resolve(directory, name)), ...optional]
    .sort((left, right) => basename(left).localeCompare(basename(right), 'en'));
  const physicalIncluded = migrations.some(filename =>
    basename(filename) === '202611150002_physical_order_collection.sql');
  for (const filename of migrations) {
    current = basename(filename);
    await db.exec((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
  }
  current = 'order collection on full schema';
  const cashier = '00000000-0000-4000-8000-000000000001';
  const activity = '00000000-0000-4000-8000-000000000002';
  const order = '00000000-0000-4000-8000-000000000003';
  const requestKey = '00000000-0000-4000-8000-000000000004';
  const customer = '00000000-0000-4000-8000-000000000006';
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [cashier, 'cashier@example.invalid']);
  await db.query("UPDATE public.profiles SET role='cashier' WHERE id=$1", [cashier]);
  await db.query("INSERT INTO public.activities(id,name,price_per_person) VALUES($1,'Group activity',1000)", [activity]);
  await db.query(`INSERT INTO public.orders(id,client_name,client_phone,client_email,organization,
    activity_id,activity_date,num_participants,price_per_person,payment_status)
    VALUES($1,'Test Group','0500000000','billing@example.invalid','Test Group',
      $2,current_date,1,1000,'לא שולם')`, [order, activity]);
  await db.query("SELECT set_config('app.test_uid',$1,false)", [cashier]);
  await db.query(`INSERT INTO public.customers(id,customer_kind,display_name,contact_name,phone,email,
    organization_name,vat_applicable,billing_name,billing_company_id,billing_accounting_email)
    VALUES($1,'organization','Test Group','Group Contact','0500000000',
    'billing@example.invalid','Test Group',true,'Test Group','123456789','billing@example.invalid')`, [customer]);
  await db.query('SELECT public.link_order_customer($1,$2,0)', [order, customer]);
  const initial = (await db.query('SELECT public.get_payper_order_collection($1,$2) AS value',
    [cashier, order])).rows[0].value;
  assert.equal(initial.balanceMinor, 100000);
  const outsider = '00000000-0000-4000-8000-000000000008';
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [outsider, 'instructor@example.invalid']);
  let forbidden = false;
  try { await db.query('SELECT public.get_payper_order_collection($1,$2)', [outsider, order]); }
  catch (error) { forbidden = /order_collection_forbidden/.test(error.message); }
  assert.equal(forbidden, true, 'instructor must not access POS collection');
  const billing = { kind: 'organization', name: 'Test Group', identity: '123456789', email: 'billing@example.invalid' };
  const collected = (await db.query(`SELECT public.record_payper_order_collection(
    $1,$2,$3,'cash',100000,NULL,$4,'invoice-receipt',NULL) AS value`,
    [cashier, requestKey, order, JSON.stringify(billing)])).rows[0].value;
  assert.equal(collected.created, true);
  assert.equal(collected.balanceMinor, 0);
  const duplicate = (await db.query(`SELECT public.record_payper_order_collection(
    $1,$2,$3,'cash',100000,NULL,$4,'invoice-receipt',NULL) AS value`,
    [cashier, requestKey, order, JSON.stringify(billing)])).rows[0].value;
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.paymentId, collected.paymentId);
  const settled = (await db.query('SELECT public.get_payper_order_collection($1,$2) AS value',
    [cashier, order])).rows[0].value;
  assert.equal(settled.balanceMinor, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.sales WHERE order_id=$1', [order])).rows[0].n, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.payper_document_ledger WHERE order_id=$1', [order])).rows[0].n, 1);
  assert.equal((await db.query('SELECT state FROM public.payper_document_ledger WHERE order_id=$1', [order])).rows[0].state, 'source_frozen');
  let rejected = false;
  try {
    await db.query(`SELECT public.record_payper_order_collection(
      $1,gen_random_uuid(),$2,'cash',100000,NULL,$3,'invoice-receipt',NULL)`,
      [cashier, order, JSON.stringify(billing)]);
  } catch (error) { rejected = /order_balance_mismatch/.test(error.message); }
  assert.equal(rejected, true, 'second full-balance collection must fail');
  const unknownVatOrder = '00000000-0000-4000-8000-000000000009';
  await db.query(`INSERT INTO public.orders(id,client_name,client_phone,client_email,organization,
    activity_id,activity_date,num_participants,price_per_person,payment_status)
    VALUES($1,'Legacy Group','0500000000','billing@example.invalid','Test Group',
      $2,current_date,1,1000,'לא שולם')`, [unknownVatOrder, activity]);
  const held = (await db.query(`SELECT public.record_payper_order_collection(
    $1,gen_random_uuid(),$2,'cash',100000,NULL,$3,'invoice-receipt',NULL) AS value`,
    [cashier, unknownVatOrder, JSON.stringify(billing)])).rows[0].value;
  assert.equal(held.created, true, 'real payment remains recorded');
  const heldLedger = (await db.query(`SELECT state,reconciliation_code FROM public.payper_document_ledger
    WHERE payment_id=$1`, [held.paymentId])).rows[0];
  assert.deepEqual(heldLedger, { state: 'source_blocked', reconciliation_code: 'vat_review_required' });
  if (physicalIncluded) {
    current = 'physical balance reservation on combined schema';
    const physicalOrder = '00000000-0000-4000-8000-000000000005';
    const priorPayment = '00000000-0000-4000-8000-000000000007';
    await db.query(`INSERT INTO public.orders(id,client_name,client_phone,client_email,organization,
      activity_id,activity_date,num_participants,price_per_person,payment_status)
      VALUES($1,'Group Contact','0500000000','billing@example.invalid','Test Group',
        $2,current_date,1,1000,'לא שולם')`, [physicalOrder, activity]);
    await db.query('SELECT public.link_order_customer($1,$2,0)', [physicalOrder, customer]);
    await db.query(`INSERT INTO public.payment_transactions(id,provider,operation,order_id,amount,currency,
      status,idempotency_key,checkout_snapshot,created_by)
      VALUES($1,'manual_cash','payment',$2,400,'ILS','succeeded','noncard-historical-fixture',
      '{"schema_version":1,"items":[]}'::jsonb,$3)`, [priorPayment, physicalOrder, cashier]);
    const priorSale = (await db.query(`INSERT INTO public.sales(items,total,method,order_id,
      payment_transaction_id,created_by) VALUES('[]'::jsonb,400,'מזומן',$1,$2,$3)
      RETURNING id`, [physicalOrder, priorPayment, cashier])).rows[0].id;
    await db.query('UPDATE public.payment_transactions SET sale_id=$1 WHERE id=$2', [priorSale, priorPayment]);
    await db.query(`INSERT INTO public.payper_noncard_payments(payment_id,sale_id,order_id,request_key,
      actor_id,method,clearance_status,document_type,billing,amount_minor)
      VALUES($1,$2,$3,gen_random_uuid(),$4,'cash','not_applicable','invoice-receipt',$5,40000)`,
      [priorPayment, priorSale, physicalOrder, cashier, JSON.stringify(billing)]);
    await db.query("UPDATE public.orders SET payment_status='שולם חלקית' WHERE id=$1", [physicalOrder]);
    await db.query("UPDATE public.physical_terminal_devices SET enabled=true,cash_register_code='GENERAL' WHERE register_number='003'");
    let hostedRejected = false;
    try {
      await db.query(`INSERT INTO public.payment_transactions(provider,operation,order_id,amount,
        currency,status,idempotency_key,checkout_snapshot,created_by)
        VALUES('pelecard','payment',$1,600,'ILS','initiated','hosted-overcharge-fixture',
          '{"schema_version":1,"items":[]}'::jsonb,$2)`, [physicalOrder, cashier]);
    } catch (error) { hostedRejected = /hosted_partial_balance_unsupported/.test(error.message); }
    assert.equal(hostedRejected, true, 'hosted full-total flow must remain blocked after partial cash');
    let overpayRejected = false;
    try {
      await db.query(`SELECT public.reserve_physical_order_payment(
        $1,gen_random_uuid(),'GENERAL',$2,60100)`, [cashier, physicalOrder]);
    } catch (error) { overpayRejected = /physical_order_balance_mismatch/.test(error.message); }
    assert.equal(overpayRejected, true, 'physical reservation must enforce remaining balance');
    const physical = (await db.query(`SELECT public.reserve_physical_order_payment(
      $1,gen_random_uuid(),'GENERAL',$2,60000) AS value`, [cashier, physicalOrder])).rows[0].value;
    assert.equal(physical.amountMinor, 60000);
  }
  const installed = (await db.query(`SELECT count(*)::int AS tables FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'`)).rows[0].tables;
  const functions = (await db.query(`SELECT count(*)::int AS functions FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'`)).rows[0].functions;
  const policies = (await db.query(`SELECT count(*)::int AS policies FROM pg_policies WHERE schemaname='public'`)).rows[0].policies;
  const triggers = (await db.query(`SELECT count(*)::int AS triggers FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`)).rows[0].triggers;
  const { constraints, unvalidated } = (await db.query(`SELECT count(*)::int AS constraints,
    count(*) FILTER (WHERE NOT c.convalidated)::int AS unvalidated
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname='public'`)).rows[0];
  assert.equal(unvalidated, 0, 'all application constraints must validate');
  console.log(JSON.stringify({ migrations: files.length, optional: optional.length,
    tables: installed, functions, policies, triggers, constraints, unvalidated,
    cashOrderCollection: 'passed',
    physicalRemainingBalance: physicalIncluded ? 'passed' : 'not_requested' }));
} catch (error) {
  console.error(`Full-schema rehearsal failed at ${current}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
