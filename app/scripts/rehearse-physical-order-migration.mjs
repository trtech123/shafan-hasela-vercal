import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      'SELECT current_setting(''app.test_role'', true)';
    SELECT set_config('app.test_role','service_role',false);
    CREATE TABLE profiles(id uuid PRIMARY KEY,role text);
    CREATE TABLE orders(id uuid PRIMARY KEY,order_number text,client_name text,client_phone text,
      client_email text,organization text,status text,archived_at timestamptz,total_price numeric,
      vat_applicable boolean,payment_status text,activity_id uuid,quote_id uuid,
      customer_snapshot_id uuid,billing_institution_name text,billing_company_id text,
      billing_signer_id text,billing_accounting_email text,num_participants integer,
      price_per_person numeric);
    CREATE TABLE activities(id uuid PRIMARY KEY,name text);
    CREATE TABLE quotes(id uuid PRIMARY KEY,discount numeric);
    CREATE TABLE customer_snapshots(id uuid PRIMARY KEY,order_id uuid,customer_kind text);
    CREATE TABLE cash_registers(code text PRIMARY KEY,active boolean);
    CREATE TABLE physical_terminal_devices(cash_register_code text PRIMARY KEY,
      enabled boolean,register_number text);
    CREATE TABLE sales(id uuid PRIMARY KEY,order_id uuid,total numeric,method text,
      payment_transaction_id uuid,linked_order_info jsonb,sale_date date);
    CREATE TABLE payment_transactions(id uuid PRIMARY KEY,provider text,operation text,
      order_id uuid,amount numeric,currency text,status text,idempotency_key text,
      checkout_snapshot jsonb,created_by uuid,sale_id uuid,
      provider_transaction_id text,verified_at timestamptz);
    CREATE TABLE physical_payment_intents(payment_id uuid PRIMARY KEY,request_key uuid UNIQUE,
      created_by uuid,workstation_code text,register_number text,terminal_number text,
      amount_minor integer,checkout_snapshot jsonb,billing_snapshot jsonb,
      state text DEFAULT 'reserved',provider_transaction_id text,provider_uid text,
      approval_id text,sale_id uuid,updated_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE payper_payment_billing_snapshots(payment_id uuid PRIMARY KEY,order_id uuid,
      source_customer_snapshot_id uuid,customer_kind text,billing_name text,
      billing_identity text,billing_email text,vat_applicable boolean);
    CREATE TABLE payper_noncard_payments(payment_id uuid PRIMARY KEY,order_id uuid);
    CREATE TABLE accounting_documents(source_type text,source_id text,status text);
    CREATE TABLE payper_document_ledger(payment_id uuid PRIMARY KEY,order_id uuid,
      sale_id uuid,state text,reconciliation_code text);
    CREATE FUNCTION finalize_pelecard_payment(uuid,text,text,text,numeric,text) RETURNS jsonb
      LANGUAGE plpgsql AS $$ BEGIN RETURN '{}'::jsonb; END $$;
    CREATE FUNCTION guard_hosted_after_noncard_partial() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.provider='pelecard' AND NEW.operation='payment' AND NEW.order_id IS NOT NULL
          AND EXISTS(SELECT 1 FROM payper_noncard_payments WHERE order_id=NEW.order_id)
        THEN RAISE EXCEPTION 'hosted_partial_balance_unsupported'; END IF;
        RETURN NEW;
      END $$;
    CREATE TRIGGER guard_hosted_after_noncard_partial BEFORE INSERT ON payment_transactions
      FOR EACH ROW EXECUTE FUNCTION guard_hosted_after_noncard_partial();
  `);
  const migration = new URL('../../supabase/migrations/202611150002_physical_order_collection.sql', import.meta.url);
  await db.exec((await readFile(fileURLToPath(migration), 'utf8')).replace(/^\uFEFF/, ''));
  const actor=id(1), order=id(2), prior=id(3);
  await query("INSERT INTO profiles VALUES($1,'cashier')",[actor]);
  await query(`INSERT INTO orders(id,order_number,client_name,client_email,organization,status,
    total_price,vat_applicable,payment_status,billing_company_id)
    VALUES($1,'ORD-2','Group','group@example.com','Club','מאושר',1000,true,'שולם חלקית','123456789')`,[order]);
  await query("INSERT INTO cash_registers VALUES('004',true)");
  await query("INSERT INTO physical_terminal_devices VALUES('004',true,'004')");
  await query(`INSERT INTO payment_transactions(id,provider,operation,order_id,amount,status)
    VALUES($1,'manual_check','payment',$2,400,'succeeded')`,[prior,order]);
  await query('INSERT INTO payper_noncard_payments VALUES($1,$2)',[prior,order]);
  const reserve = 'SELECT reserve_physical_order_payment($1,$2,$3,$4,$5) AS result';
  const request=id(4);
  const first=(await query(reserve,[actor,request,'004',order,60000]))[0].result;
  assert.equal(first.amountMinor,60000);
  assert.equal((await query(reserve,[actor,request,'004',order,60000]))[0].result.paymentId,first.paymentId);
  await assert.rejects(() => query(reserve,[actor,id(5),'004',order,60001]),
    error => error.message.includes('order_payment_unresolved'));
  console.log('Physical pending-payment fence passed.');
  await assert.rejects(() => query(`INSERT INTO payment_transactions(id,provider,operation,order_id,
    amount,status) VALUES($1,'pelecard','payment',$2,600,'initiated')`,[id(6),order]),
    error => error.message.includes('hosted_partial_balance_unsupported'));
  assert.equal((await query('SELECT count(*)::int AS n FROM payment_transactions WHERE order_id=$1',[order]))[0].n,2);
  const documented=id(8);
  await query(`INSERT INTO orders(id,order_number,client_name,client_email,organization,status,
    total_price,vat_applicable,payment_status,billing_company_id)
    VALUES($1,'ORD-8','Other Group','group@example.com','Club','מאושר',1000,true,'לא שולם','123456789')`,[documented]);
  await query("INSERT INTO accounting_documents VALUES('order',$1,'succeeded')",[documented]);
  await assert.rejects(() => query(reserve,[actor,id(9),'004',documented,100000]),
    error => error.message.includes('physical_order_document_review_required'));
  console.log('Isolated physical migration rehearsal passed: post-check balance, correlated reservation, retry idempotency, hosted guard, overpayment fence, existing-document hold.');
} catch (error) {
  console.error('Isolated physical migration rehearsal failed:',error.message);
  process.exitCode=1;
} finally { await db.close(); }
