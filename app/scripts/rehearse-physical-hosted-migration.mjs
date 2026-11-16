import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE_URL || '@electric-sql/pglite');

const db = new PGlite();
const payment = '11111111-1111-4111-8111-111111111111';
const sale = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const hosted = '44444444-4444-4444-8444-444444444444';
const call = async (sql, args = []) => (await db.query(sql, args)).rows;
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      'SELECT current_setting(''app.test_role'', true)';
    SELECT set_config('app.test_role','service_role',false);
    CREATE TABLE public.physical_payment_intents(
      payment_id uuid PRIMARY KEY,request_key uuid,created_by uuid,workstation_code text,
      register_number text,terminal_number text,amount_minor integer,checkout_snapshot jsonb,
      billing_snapshot jsonb,state text,dispatch_started_at timestamptz,
      provider_transaction_id text,provider_uid text,approval_id text,sale_id uuid,
      created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz);
    CREATE TABLE public.payment_transactions(id uuid PRIMARY KEY,order_id uuid,provider text,
      operation text,amount numeric,currency text,status text,sale_id uuid,
      provider_transaction_id text,created_at timestamptz DEFAULT clock_timestamp(),
      verified_at timestamptz);
    CREATE TABLE public.sales(id uuid PRIMARY KEY,total numeric,payment_transaction_id uuid);
    CREATE TABLE public.payper_document_ledger(payment_id uuid PRIMARY KEY,order_id uuid,
      sale_id uuid,state text,reconciliation_code text,document_number text UNIQUE,
      document_url text,document_origin text,source_facts jsonb,source_frozen_at timestamptz,
      dispatch_reserved_at timestamptz,provider_trx_record_id text,updated_at timestamptz);
    CREATE TABLE public.accounting_documents(source_id text,status text);
    CREATE FUNCTION public.payper_valid_person_identity(text) RETURNS boolean
      LANGUAGE sql IMMUTABLE AS 'SELECT $1=''123456782''';
  `);
  const migration = new URL('../../supabase/migrations/202611150004_physical_hosted_emv.sql', import.meta.url);
  await db.exec((await readFile(migration, 'utf8')).replace(/^\uFEFF/, ''));
  const documentLinkFix = new URL('../../supabase/migrations/202611160004_hosted_document_link_identity.sql', import.meta.url);
  await db.exec((await readFile(documentLinkFix, 'utf8')).replace(/^\uFEFF/, ''));
  await call(`INSERT INTO public.payment_transactions(id,provider,operation,amount,currency,status)
    VALUES($1,'pelecard','payment',118,'ILS','initiated')`, [payment]);
  await call(`INSERT INTO public.physical_payment_intents(payment_id,request_key,created_by,
    workstation_code,register_number,terminal_number,amount_minor,checkout_snapshot,
    billing_snapshot,state) VALUES($1,$2,$3,'FRONT','004','2814926015',11800,'{}',
      '{"kind":"person","name":"Synthetic","identity":"123456782","email":"synthetic@example.test","vatApplicable":true}',
      'reserved')`, [payment, payment, actor]);
  await assert.rejects(() => call(`INSERT INTO public.physical_payment_intents(
    payment_id,request_key,created_by,workstation_code,register_number,terminal_number,
    amount_minor,checkout_snapshot,billing_snapshot,state)
    VALUES($1,$1,$2,'FRONT','004','2814926015',11800,'{}',
      '{"kind":"person","name":"Synthetic","identity":"123456782","email":"synthetic@example.test","vatApplicable":null}',
      'reserved')`, [hosted, actor]));
  assert.equal((await call('SELECT public.claim_physical_hosted_init($1) AS result', [payment]))[0].result, true);
  assert.equal((await call('SELECT public.claim_physical_hosted_init($1) AS result', [payment]))[0].result, false);
  assert.deepEqual((await call('SELECT public.list_physical_worker_intents() AS result'))[0].result, []);
  const url = `https://gateway21.pelecard.biz/PaymentGW?transactionId=${hosted}`;
  assert.equal((await call('SELECT public.persist_physical_hosted_session($1,$2,$3,$4) AS result',
    [payment, hosted, 'synthetic-confirmation', url]))[0].result, true);
  assert.equal((await call('SELECT public.get_physical_worker_intent($1) AS result', [payment]))[0]
    .result.hostedTransactionId, hosted);
  await call('INSERT INTO public.sales VALUES($1,118,$2)', [sale, payment]);
  await call(`UPDATE public.payment_transactions SET status='succeeded',sale_id=$2,
    provider_transaction_id='12345',verified_at=clock_timestamp() WHERE id=$1`, [payment, sale]);
  await call(`UPDATE public.physical_payment_intents SET state='succeeded',sale_id=$2,
    provider_transaction_id='12345',provider_uid='uid-1' WHERE payment_id=$1`, [payment, sale]);
  await call(`INSERT INTO public.payper_document_ledger(payment_id,sale_id,state,reconciliation_code)
    VALUES($1,$2,'source_blocked','physical_provider_confirmation_required')`, [payment, sale]);
  const document = 'https://app.payper.co.il/public/invoice_show/3630819';
  const record = 'SELECT public.record_physical_hosted_document($1,$2,$3,$4) AS result';
  await assert.rejects(() => call(record, [payment, '200004', document, '595170']));
  assert.equal((await call(record, [payment, '200004', document, '3630819']))[0].result, true);
  assert.equal((await call(record, [payment, '200004', document, '3630819']))[0].result, true);
  await assert.rejects(() => call(record, [payment, '200005', document, '3630819']));
  const ledger = (await call('SELECT state,physical_document_system_id FROM public.payper_document_ledger'))[0];
  assert.deepEqual(ledger, { state: 'succeeded', physical_document_system_id: '3630819' });
  console.log('Isolated hosted migration passed: one-shot claim, direct-worker exclusion, session persistence, exact document association and duplicate refusal.');
} catch (error) {
  console.error('Isolated hosted migration failed:', error.message);
  process.exitCode = 1;
} finally { await db.close(); }
