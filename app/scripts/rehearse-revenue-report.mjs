import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE_BASE
  ? pathToFileURL(resolve(process.env.PGLITE_MODULE_BASE, 'dist/index.js')).href
  : '@electric-sql/pglite');

const db = new PGlite();
const migration = fileURLToPath(new URL('../../supabase/migrations/202611250010_revenue_report.sql', import.meta.url));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const report = async (from, to, site = null, customerType = null) => {
  const { rows } = await db.query('SELECT public.get_revenue_report($1,$2,$3,$4) AS value',
    [from, to, site, customerType]);
  return rows[0].value;
};
const amount = (rows, kind) => rows.filter(row => row.kind === kind)
  .reduce((sum, row) => sum + row.amountMinor, 0);

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''app.test_uid'',true),'''')::uuid';
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      'SELECT current_setting(''app.test_role'',true)';
    SELECT set_config('app.test_role','authenticated',false);
    SELECT set_config('app.test_uid','${id(1)}',false);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text);
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS
      'SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role=''admin'')';
    CREATE TABLE public.customer_snapshots(id uuid PRIMARY KEY, customer_type text);
    CREATE TABLE public.orders(id uuid PRIMARY KEY, order_number text, activity_date date,
      site text, customer_snapshot_id uuid, status text, total_price numeric);
    CREATE TABLE public.sales(id uuid PRIMARY KEY, order_id uuid, payment_transaction_id uuid,
      sale_date date, total numeric, method text, payment_details jsonb);
    CREATE TABLE public.payment_transactions(id uuid PRIMARY KEY, order_id uuid, sale_id uuid,
      parent_transaction_id uuid, provider text, operation text, status text, amount numeric,
      currency text NOT NULL DEFAULT 'ILS', checkout_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
      verified_at timestamptz, created_at timestamptz, updated_at timestamptz);
    INSERT INTO public.profiles VALUES('${id(1)}','admin'),('${id(2)}','cashier');
    INSERT INTO public.customer_snapshots VALUES('${id(11)}','חברה'),('${id(12)}',NULL);
    INSERT INTO public.orders VALUES
      ('${id(21)}','ORD-21','2026-11-10','עכו','${id(11)}','מאושר',100),
      ('${id(22)}','ORD-22','2026-11-10','טבריה','${id(12)}','בוטל',50),
      ('${id(23)}','ORD-23','2026-11-10','עכו','${id(12)}','מאושר',40);
    INSERT INTO public.sales(id,order_id,payment_transaction_id,sale_date,total,method) VALUES
      ('${id(31)}','${id(21)}','${id(41)}','2026-11-11',70,'פלאקארד'),
      ('${id(32)}','${id(21)}','${id(42)}','2026-11-12',20,'מזומן'),
      ('${id(33)}','${id(21)}',NULL,'2026-11-12',7,'צ''ק'),
      ('${id(34)}',NULL,NULL,'2026-11-12',12,'מזומן'),
      ('${id(35)}',NULL,NULL,'2026-11-12',99,'אשראי');
    INSERT INTO public.sales VALUES
      ('${id(36)}','${id(21)}',NULL,'2026-11-12',10,'מפוצל',
        '{"lines":[{"method":"מזומן","amount":5},{"method":"אשראי","amount":5},{"method":"צ''ק","amount":"invalid"}]}');
    INSERT INTO public.sales VALUES
      ('${id(37)}',NULL,'${id(47)}','2026-11-11',3,'פלאקארד',NULL);
    INSERT INTO public.payment_transactions(id,order_id,sale_id,parent_transaction_id,provider,operation,status,amount,checkout_snapshot,verified_at,created_at,updated_at) VALUES
      ('${id(41)}','${id(21)}','${id(31)}',NULL,'pelecard','payment','succeeded',70,'{"site":"עכו"}','2026-11-11 10:00+00','2026-11-11 09:00+00','2026-11-11 10:00+00'),
      ('${id(42)}','${id(21)}','${id(32)}',NULL,'manual_cash','payment','succeeded',20,'{}',NULL,'2026-11-12 10:00+00','2026-11-12 10:00+00'),
      ('${id(43)}','${id(21)}',NULL,'${id(41)}','pelecard','refund','refunded',10,'{}',NULL,'2026-11-12 09:00+00','2026-11-13 10:00+00'),
      ('${id(44)}','${id(21)}',NULL,NULL,'pelecard','payment','failed',200,'{}',NULL,'2026-11-11 10:00+00','2026-11-11 10:00+00'),
      ('${id(45)}','${id(21)}',NULL,NULL,'pelecard','payment','succeeded',5,'{"site":"עכו"}','2026-11-12 10:00+00','2026-11-12 09:00+00','2026-11-12 10:00+00'),
      ('${id(46)}','${id(21)}',NULL,'${id(45)}','pelecard','void','voided',5,'{}',NULL,'2026-11-12 09:00+00','2026-11-13 10:00+00'),
      ('${id(47)}',NULL,'${id(37)}',NULL,'pelecard','payment','succeeded',3,'{"site":"טבריה"}','2026-11-11 10:00+00','2026-11-11 09:00+00','2026-11-11 10:00+00');
  `);
  await db.exec(await readFile(migration, 'utf8'));

  const all = await report('2026-11-10','2026-11-13');
  assert.equal(amount(all.rows, 'order'), 14000);
  assert.equal(amount(all.rows, 'cancelled'), 5000);
  assert.equal(amount(all.rows, 'receipt'), 12200); // Ledger, legacy cash/check, split cash and frozen-site POS.
  assert.equal(amount(all.rows, 'refund'), 1000);
  assert.equal(amount(all.rows, 'void'), 500);
  assert.equal(all.rows.find(row => row.site === null && row.kind === 'receipt').amountMinor, 1200);
  const company = await report('2026-11-10','2026-11-13','עכו','חברה');
  assert.equal(amount(company.rows, 'order'), 10000);
  assert.equal(amount(company.rows, 'receipt'), 10700);
  assert.equal(amount(company.rows, 'refund'), 1000);
  assert.equal(amount(company.rows, 'void'), 500);
  const unknownType = await report('2026-11-10','2026-11-13',null,'__unknown__');
  assert.equal(amount(unknownType.rows, 'order'), 4000);
  assert.equal(amount(unknownType.rows, 'cancelled'), 5000);
  const unknownSite = await report('2026-11-10','2026-11-13','__unknown__');
  assert.equal(amount(unknownSite.rows, 'receipt'), 1200);
  const frozenPosSite = await report('2026-11-10','2026-11-13','טבריה');
  assert.equal(amount(frozenPosSite.rows, 'receipt'), 300);
  const unknown = await report('2026-11-10','2026-11-13','עכו',null);
  assert.equal(amount(unknown.rows, 'order'), 14000);
  const paymentDay = await report('2026-11-11','2026-11-11');
  assert.equal(amount(paymentDay.rows, 'order'), 0);
  assert.equal(amount(paymentDay.rows, 'receipt'), 7300);
  const adjustmentDay = await report('2026-11-13','2026-11-13');
  assert.equal(amount(adjustmentDay.rows, 'refund'), 1000);
  assert.equal(amount(adjustmentDay.rows, 'void'), 500);
  await db.exec(`SELECT set_config('app.test_uid','${id(2)}',false)`);
  await assert.rejects(() => report('2026-11-10','2026-11-13'), /revenue_report_forbidden/);
  await db.exec(`SELECT set_config('app.test_uid','${id(1)}',false)`);
  await assert.rejects(() => report('2026-11-14','2026-11-13'), /revenue_report_invalid_range/);
  await db.exec("SELECT set_config('app.test_role','anon',false)");
  await assert.rejects(() => report('2026-11-10','2026-11-13'), /revenue_report_forbidden/);
  console.log('PASS: revenue report SQL aggregation, deduplication, historical type and access');
} finally {
  await db.close();
}
