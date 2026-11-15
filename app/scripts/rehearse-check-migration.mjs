import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { buildNoncardPayperRequest, dispatchNoncardPayper } from '../../supabase/functions/_shared/payper/noncard.ts';

const root = new URL('../../supabase/migrations/202611150001_payper_check_payments.sql', import.meta.url);
const db = new PGlite();
let phase = 'schema fixture';
const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const sql = async (statement, params = []) => (await db.query(statement, params)).rows;
const rejects = async (statement, params, message) => {
  await assert.rejects(() => sql(statement, params), error => error.message.includes(message));
};

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      'SELECT current_setting(''app.test_role'', true)';
    SELECT set_config('app.test_role','service_role',false);
    CREATE TABLE profiles(id uuid PRIMARY KEY, role text NOT NULL);
    CREATE TABLE activities(id uuid PRIMARY KEY, name text, price_per_person numeric, status text);
    CREATE TABLE products(id uuid PRIMARY KEY, name text, price numeric, status text);
    CREATE TABLE orders(id uuid PRIMARY KEY, order_number text UNIQUE, client_name text,
      client_email text, organization text, status text, total_price numeric,
      payment_status text NOT NULL, archived_at timestamptz, activity_id uuid,
      activity_date date, num_participants integer, price_per_person numeric, quote_id uuid,
      billing_institution_name text, billing_company_id text, billing_accounting_email text,
      CONSTRAINT orders_payment_status_check CHECK
        (payment_status IN ('לא שולם','שובר','אשראי','צ''ק','מזומן','פלאקארד')));
    CREATE SEQUENCE receipt_sequence START 2000;
    CREATE TABLE sales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      receipt_number text DEFAULT 'RCP-' || nextval('receipt_sequence'), items jsonb,
      total numeric, method text, payment_details jsonb, discount jsonb,
      sale_date date, created_by uuid, order_id uuid, linked_order_info jsonb,
      payment_transaction_id uuid);
    CREATE TABLE payment_transactions(id uuid PRIMARY KEY, provider text NOT NULL,
      operation text, sale_id uuid, order_id uuid, amount numeric, currency text,
      status text, idempotency_key text, checkout_snapshot jsonb, created_by uuid,
      created_at timestamptz DEFAULT clock_timestamp(),
      CONSTRAINT payment_transactions_provider_check CHECK (provider='pelecard'));
    CREATE TABLE payper_document_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_id uuid UNIQUE, order_id uuid NOT NULL, sale_id uuid,
      state text, reconciliation_code text, source_facts jsonb,
      source_frozen_at timestamptz, dispatch_reserved_at timestamptz,
      updated_at timestamptz DEFAULT clock_timestamp(), created_at timestamptz DEFAULT clock_timestamp(),
      document_number text, document_url text, provider_trx_record_id text,
      document_origin text DEFAULT 'automatic',
      CONSTRAINT payper_reserved_requires_trx_record CHECK
        (state NOT IN ('dispatch_reserved','reconciliation_required','succeeded')
          OR provider_trx_record_id IS NOT NULL OR (state='succeeded' AND document_origin='manual')));
    CREATE UNIQUE INDEX payper_document_ledger_order_unique ON payper_document_ledger(order_id);
    CREATE TABLE accounting_events(source_type text, source_id text, purpose text,
      accounting_provider text, status text, updated_at timestamptz);
    CREATE TABLE accounting_documents(source_type text, source_id text, status text,
      document_type_key text, provider text, external_document_id text);
    CREATE FUNCTION payper_valid_person_identity(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
    CREATE FUNCTION hold_payper_source(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
    CREATE FUNCTION record_payper_dispatch_outcome_v2(uuid,text,text,text,text,boolean,text,text,text)
      RETURNS text LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE public.payper_document_ledger SET state=$2, document_number=$3, document_url=$4,
          reconciliation_code=$5 WHERE payment_id=$1 AND state='dispatch_reserved';
        RETURN $2;
      END $$;
  `);
  phase = 'migration';
  await db.exec((await readFile(fileURLToPath(root), 'utf8')).replace(/^\uFEFF/, ''));
  phase = 'payment fixtures';
  const admin = id(1), cashier = id(2), activity = id(3), order = id(4);
  await sql('INSERT INTO profiles VALUES ($1,\'admin\'),($2,\'cashier\'),($3,\'viewer\')', [admin, cashier, id(9)]);
  await sql('INSERT INTO activities VALUES ($1,\'Group activity\',100,\'פעיל\')', [activity]);
  await sql(`INSERT INTO orders(id,order_number,client_name,client_email,organization,status,
    total_price,payment_status,activity_id,activity_date,num_participants,price_per_person)
    VALUES($1,'ORD-1','Group','group@example.com','Club','מאושר',1000,'לא שולם',$2,CURRENT_DATE,10,100)`, [order, activity]);
  const billing = { kind: 'organization', name: 'Club', identity: '123456789', email: 'group@example.com' };
  const check = { check_number: '00042', bank: 'Bank', branch: '012', account_number: '00123',
    account_holder: 'Club', amount: '1000', received_date: new Date().toISOString().slice(0, 10),
    due_date: '2027-01-15' };
  const collect = `SELECT record_payper_order_collection($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result`;
  await rejects(collect, [id(9), id(8), order, 'check', 100000, check, billing,
    'invoice-receipt', null], 'order_collection_forbidden');
  await rejects(collect, [cashier, id(10), order, 'check', 99900, check, billing, 'invoice-receipt', null], 'order_balance_mismatch');
  await rejects(collect, [cashier, id(10), order, 'check', 100000,
    { ...check, amount: '900' }, billing, 'invoice-receipt', null], 'check_amount_mismatch');
  const key = id(11);
  const first = (await sql(collect, [cashier, key, order, 'check', 100000,
    check, billing, 'invoice-receipt', null]))[0].result;
  assert.equal(first.created, true);
  assert.equal(first.balanceMinor, 0);
  assert.equal((await sql(collect, [cashier, key, order, 'check', 100000,
    check, billing, 'invoice-receipt', null]))[0].result.created, false);
  await rejects(collect, [cashier, key, order, 'cash', 100000,
    null, billing, 'invoice-receipt', null], 'request_key_conflict');
  assert.equal((await sql('SELECT count(*)::int AS n FROM sales WHERE order_id=$1', [order]))[0].n, 1);
  assert.equal((await sql('SELECT payment_status FROM orders WHERE id=$1', [order]))[0].payment_status, "צ'ק");
  assert.equal((await sql('SELECT clearance_status FROM payper_noncard_payments WHERE payment_id=$1', [first.paymentId]))[0].clearance_status, 'received_uncleared');
  await rejects(collect, [admin, id(12), order, 'cash', 100000, null, billing,
    'invoice-receipt', null], 'order_balance_mismatch');
  const source = (await sql(`SELECT n.method,n.document_type,n.reference_document_id,
    n.check_details,n.billing,n.amount_minor,s.items,s.discount,s.receipt_number,s.sale_date
    FROM payper_noncard_payments n JOIN sales s ON s.id=n.sale_id WHERE n.payment_id=$1`, [first.paymentId]))[0];
  const request = buildNoncardPayperRequest({ amountMinor: source.amount_minor,
    method: source.method, documentType: source.document_type,
    referenceDocumentId: source.reference_document_id, receiptNumber: source.receipt_number,
    paidDate: source.sale_date.toISOString().slice(0, 10), items: source.items,
    discount: source.discount, billing: source.billing, check: source.check_details },
  { terminalNumber: 'test', user: 'test', password: 'test' });
  assert.equal(request.PayperParameters.typeDocument, 'invoice-receipt');
  assert.equal(request.PayperParameters.DataPayper.receipt_lines[0].payment_type, 'Check');
  assert.equal(request.trxRecordId, '');
  await sql('SELECT reserve_check_payper_dispatch($1)', [first.paymentId]);
  let calls = 0;
  const outcome = await dispatchNoncardPayper(request, async (_url, options) => {
    calls += 1;
    assert.equal(JSON.parse(options.body).PayperParameters.DataPayper.send_by_mail, 'true');
    return new Response(JSON.stringify({ StatusCode: '000', PayperData: {
      InvoiceStatus: 'Success', InvoiceNumber: '2000',
      InvoiceLink: 'https://app.payper.co.il/public/invoice_show/2000',
    } }), { status: 200 });
  });
  assert.equal(calls, 1);
  assert.equal(outcome.state, 'succeeded');
  await sql(`SELECT record_check_payper_outcome($1,'succeeded',$2,$3,NULL,true,'000','Success',NULL)`,
    [first.paymentId, outcome.documentNumber, outcome.documentUrl]);
  assert.equal((await sql('SELECT state FROM payper_document_ledger WHERE payment_id=$1', [first.paymentId]))[0].state, 'succeeded');

  const second = id(20);
  await sql(`INSERT INTO orders(id,order_number,client_name,organization,status,total_price,
    payment_status,activity_id,activity_date,num_participants,price_per_person)
    VALUES($1,'ORD-2','Group 2','Club','מאושר',1000,'שולם חלקית',$2,CURRENT_DATE,10,100)`, [second, activity]);
  await sql(`INSERT INTO payment_transactions(id,provider,operation,order_id,amount,currency,status)
    VALUES($1,'pelecard','payment',$2,400,'ILS','succeeded')`, [id(21), second]);
  const status = (await sql('SELECT get_payper_order_collection($1,$2) AS result', [admin, second]))[0].result;
  assert.equal(status.balanceMinor, 60000);
  await rejects(collect, [admin, id(22), second, 'cash', 50000, null, billing,
    'invoice-receipt', null], 'order_balance_mismatch');
  const cash = (await sql(collect, [admin, id(23), second, 'cash', 60000, null, billing,
    'invoice-receipt', null]))[0].result;
  assert.equal(cash.balanceMinor, 0);
  assert.equal((await sql('SELECT state FROM payper_document_ledger WHERE payment_id=$1', [cash.paymentId]))[0].state, 'source_frozen');

  const third = id(30);
  await sql(`INSERT INTO orders(id,order_number,client_name,organization,status,total_price,
    payment_status,activity_id,activity_date,num_participants,price_per_person)
    VALUES($1,'ORD-3','Group 3','Club','מאושר',1000,'לא שולם',$2,CURRENT_DATE,10,100)`, [third, activity]);
  await sql(`INSERT INTO accounting_documents(source_type,source_id,status,document_type_key,provider)
    VALUES('order',$1,'succeeded','invoice','payper')`, [third]);
  const held = (await sql(collect, [admin, id(31), third, 'cash', 100000, null, billing,
    'invoice-receipt', null]))[0].result;
  assert.equal((await sql('SELECT state FROM payper_document_ledger WHERE payment_id=$1', [held.paymentId]))[0].state, 'source_blocked');
  assert.equal((await sql('SELECT status FROM accounting_events WHERE source_id=$1', [held.paymentId]))[0].status, 'configuration_required');
  await rejects('SELECT reserve_check_payper_dispatch($1)', [held.paymentId], 'check_payper_dispatch_fence');
  console.log('Isolated PostgreSQL rehearsal passed: migration, permissions, full balance, history, idempotency, mocked Payper issuance, existing-document hold.');
} catch (error) {
  console.error(`Migration rehearsal failed during ${phase}:`, error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
