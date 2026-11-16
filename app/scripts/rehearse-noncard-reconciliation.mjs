import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const payment = '11111111-1111-4111-8111-111111111111';
const sale = '22222222-2222-4222-8222-222222222222';
const order = '33333333-3333-4333-8333-333333333333';
const actor = '44444444-4444-4444-8444-444444444444';
const url = 'https://app.payper.co.il/public/invoice_show/3630819?ak=opaqueproviderkey123456789';
const call = async (sql, args = []) => (await db.query(sql, args)).rows;
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      'SELECT current_setting(''app.test_role'', true)';
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT NULL::uuid';
    SELECT set_config('app.test_role','service_role',false);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text);
    CREATE TABLE public.payment_transactions(id uuid PRIMARY KEY,order_id uuid,provider text,
      operation text,amount numeric,currency text,status text,sale_id uuid);
    CREATE TABLE public.sales(id uuid PRIMARY KEY,order_id uuid,payment_transaction_id uuid,
      total numeric,receipt_number text,sale_date date);
    CREATE TABLE public.payper_document_ledger(payment_id uuid PRIMARY KEY,order_id uuid,
      sale_id uuid,state text,reconciliation_code text,document_origin text,
      document_number text UNIQUE,document_url text,dispatch_reserved_at timestamptz,
      provider_trx_record_id text,updated_at timestamptz);
    CREATE TABLE public.payper_noncard_payments(payment_id uuid PRIMARY KEY,method text,
      document_type text,amount_minor integer);
    CREATE TABLE public.payper_provider_response_diagnostics(payment_id uuid PRIMARY KEY,
      response_received boolean);
    CREATE TABLE public.accounting_documents(source_id text,status text);
    CREATE TABLE public.accounting_events(source_type text,source_id text,purpose text,
      accounting_provider text,status text,updated_at timestamptz);
    CREATE FUNCTION public.reject_payper_manual_audit_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;
  `);
  const migration = new URL('../../supabase/migrations/202611160002_payper_noncard_verified_reconciliation.sql', import.meta.url);
  await db.exec((await readFile(migration, 'utf8')).replace(/^\uFEFF/, ''));
  await call("INSERT INTO public.profiles VALUES($1,'admin')", [actor]);
  await call(`INSERT INTO public.payment_transactions VALUES($1,$2,'manual_cash','payment',15,'ILS','succeeded',$3)`,
    [payment, order, sale]);
  await call("INSERT INTO public.sales VALUES($1,$2,$3,15,'RCP-1045','2026-11-16')", [sale, order, payment]);
  await call(`INSERT INTO public.payper_document_ledger VALUES($1,$2,$3,'reconciliation_required',
    'provider_response_uncertain','automatic',NULL,NULL,clock_timestamp(),NULL,clock_timestamp())`,
    [payment, order, sale]);
  await call("INSERT INTO public.payper_noncard_payments VALUES($1,'cash','invoice-receipt',1500)", [payment]);
  await call('INSERT INTO public.payper_provider_response_diagnostics VALUES($1,true)', [payment]);
  await call("INSERT INTO public.accounting_events VALUES('payment_transaction',$1,'noncard_payment','payper','reconciliation_required',clock_timestamp())", [payment]);

  const confirm = `SELECT public.confirm_payper_noncard_existing_document(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result`;
  const evidence = [actor,payment,'3630819','200004',url,'2026-11-16',15,'RCP-1045',
    'payper-dashboard:3630819','gmail-message:synthetic-confirmed'];
  await assert.rejects(() => call(confirm, [...evidence.slice(0, 4),
    url.replace('3630819', '9999999'), ...evidence.slice(5)]));
  await assert.rejects(() => call(confirm, [...evidence.slice(0, 6), 16, ...evidence.slice(7)]));
  assert.deepEqual((await call('SELECT state,document_number FROM public.payper_document_ledger'))[0],
    { state: 'reconciliation_required', document_number: null });
  assert.equal((await call(confirm, evidence))[0].result, true);
  assert.deepEqual((await call('SELECT state,document_number,document_url FROM public.payper_document_ledger'))[0],
    { state: 'succeeded', document_number: '200004', document_url: url });
  assert.equal((await call('SELECT status FROM public.accounting_events'))[0].status, 'succeeded');
  assert.equal((await call('SELECT count(*)::integer AS n FROM public.payper_noncard_document_confirmation_audit'))[0].n, 1);
  await assert.rejects(() => call(confirm, evidence));
  await assert.rejects(() => call('DELETE FROM public.payper_noncard_document_confirmation_audit'));
  console.log('Isolated noncard reconciliation passed: mismatched evidence rejected, existing invoice matched once, duplicate refused, immutable audit.');
} catch (error) {
  console.error('Isolated noncard reconciliation failed:', error.message);
  process.exitCode = 1;
} finally { await db.close(); }
