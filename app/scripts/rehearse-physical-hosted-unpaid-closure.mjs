import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const order = '11111111-1111-4111-8111-111111111111';
const payment = '22222222-2222-4222-8222-222222222222';
const session = '33333333-3333-4333-8333-333333333333';
const reference = 'Verbal confirmation from Pelecard support that no charge occurred for this session.';
const call = async (sql, args = []) => (await db.query(sql, args)).rows;
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      'SELECT current_setting(''app.test_role'', true)';
    SELECT set_config('app.test_role','service_role',false);
    CREATE TABLE public.orders(id uuid PRIMARY KEY,order_number text,total_price numeric,
      payment_status text,status text);
    CREATE TABLE public.payment_transactions(id uuid PRIMARY KEY,order_id uuid,
      provider text,operation text,currency text,status text,amount numeric,
      sale_id uuid,provider_transaction_id text,approval_id text,verified_at timestamptz,
      provider_status_code text);
    CREATE TABLE public.physical_payment_intents(payment_id uuid PRIMARY KEY,
      register_number text,route text,state text,dispatch_started_at timestamptz,
      hosted_transaction_id text,hosted_redirect_url text,provider_transaction_id text,
      provider_uid text,approval_id text,sale_id uuid,amount_minor integer,
      updated_at timestamptz);
    CREATE UNIQUE INDEX physical_one_unresolved_per_register ON
      public.physical_payment_intents(register_number) WHERE state IN
      ('reserved','dispatching','pending','uncertain','approved');
    CREATE TABLE public.sales(order_id uuid,payment_transaction_id uuid,
      linked_order_info jsonb);
    CREATE TABLE public.payper_document_ledger(payment_id uuid,order_id uuid);
    CREATE TABLE public.accounting_documents(source_id text);
  `);
  const migration = new URL('../../supabase/migrations/202611160005_physical_hosted_unpaid_closure.sql', import.meta.url);
  await db.exec(await readFile(migration, 'utf8'));
  await call(`INSERT INTO public.orders VALUES($1,'ORD-TEST',15,'לא שולם','ממתין לאישור')`, [order]);
  await call(`INSERT INTO public.payment_transactions(id,order_id,provider,operation,currency,status,amount)
    VALUES($1,$2,'pelecard','payment','ILS','pending_provider',15)`, [payment, order]);
  await call(`INSERT INTO public.physical_payment_intents(payment_id,register_number,route,state,
    dispatch_started_at,hosted_transaction_id,hosted_redirect_url,amount_minor)
    VALUES($1,'004','hosted','uncertain',clock_timestamp()-interval '1 hour',$2,
      'https://gateway21.pelecard.biz/PaymentGW?transactionId='||$2,1500)`, [payment, session]);
  const observedAt = new Date().toISOString();
  const sql = `SELECT public.close_physical_hosted_expired_unpaid(
    $1,$2,$3,CURRENT_DATE,$4,$5::timestamptz,'0003') AS result`;
  await assert.rejects(() => call(sql, [payment, session,
    'provider_phone_confirmation', 'short', observedAt]));
  await assert.rejects(() => call(sql.replace("'0003'", "'0000'"),
    [payment, session, 'provider_phone_confirmation', reference, observedAt]));
  await call(`UPDATE public.payment_transactions SET provider_transaction_id='approved'
    WHERE id=$1`, [payment]);
  await assert.rejects(() => call(sql,
    [payment, session, 'provider_phone_confirmation', reference, observedAt]));
  await call(`UPDATE public.payment_transactions SET provider_transaction_id=NULL
    WHERE id=$1`, [payment]);
  const result = (await call(sql, [payment, session,
    'provider_phone_confirmation', reference, observedAt]))[0].result;
  assert.equal(result.state, 'canceled');
  assert.equal(result.paymentStatus, 'expired');
  assert.deepEqual((await call(sql, [payment, session,
    'provider_phone_confirmation', reference, observedAt]))[0].result, result);
  assert.equal((await call('SELECT count(*)::integer AS n FROM public.physical_hosted_unpaid_confirmations'))[0].n, 1);
  assert.deepEqual((await call('SELECT state FROM public.physical_payment_intents WHERE payment_id=$1', [payment]))[0],
    { state: 'canceled' });
  assert.deepEqual((await call('SELECT status FROM public.payment_transactions WHERE id=$1', [payment]))[0],
    { status: 'expired' });
  // The partial index no longer holds the register, while the old rows persist.
  await call(`INSERT INTO public.physical_payment_intents(payment_id,register_number,state)
    VALUES('44444444-4444-4444-8444-444444444444','004','reserved')`);
  assert.equal((await call('SELECT count(*)::integer AS n FROM public.physical_payment_intents'))[0].n, 2);
  console.log('Hosted unpaid closure rehearsal passed.');
} finally { await db.close(); }
