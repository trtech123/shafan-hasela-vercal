import { readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { buildNoncardPayperRequest, dispatchNoncardPayper } from
  '../../supabase/functions/_shared/payper/noncard.ts';
import { buildCreatePayperInvoice } from '../../supabase/functions/_shared/payper/provider.ts';

const directory = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const optional = process.argv.slice(2).filter(arg => arg.endsWith('.sql')).map(arg => resolve(arg));
const db = new PGlite({ extensions: { 'uuid-ossp': uuid_ossp, pg_trgm } });
let current = 'Supabase bootstrap';
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA extensions;
    CREATE FUNCTION extensions.uuid_generate_v4() RETURNS uuid LANGUAGE sql VOLATILE AS
      'SELECT pg_catalog.gen_random_uuid()';
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
  current = 'digital order eligibility and immutable invoice source';
  const digitalOrder = '00000000-0000-4000-8000-000000000010';
  await db.query('UPDATE public.payper_dispatch_control SET activation_cutoff_utc=statement_timestamp() WHERE singleton');
  await db.query(`INSERT INTO public.orders(id,client_name,client_phone,client_email,organization,
    activity_id,activity_date,num_participants,price_per_person,payment_status)
    VALUES($1,'Test Group','0500000000','billing@example.invalid','Test Group',
      $2,current_date,1,1000,'לא שולם')`, [digitalOrder, activity]);
  await db.query('SELECT public.link_order_customer($1,$2,0)', [digitalOrder, customer]);
  const issues = (await db.query('SELECT public.digital_order_payment_issues($1,$2,$3) AS value',
    [digitalOrder, cashier, JSON.stringify(billing)])).rows[0].value;
  assert.deepEqual(issues, []);
  const missing = (await db.query('SELECT public.digital_order_payment_issues($1,$2,$3) AS value',
    [digitalOrder, cashier, JSON.stringify({ ...billing, identity: '', email: '' })])).rows[0].value;
  assert.ok(missing.includes('billing_identity_required'));
  assert.ok(missing.includes('billing_email_required'));
  let blocked = false;
  try { await db.query('SELECT public.reserve_pelecard_live_order($1,$2,100000,NULL,$3)',
    [digitalOrder, cashier, JSON.stringify({ ...billing, identity: '' })]); }
  catch (error) { blocked = /digital_order_not_eligible/.test(error.message); }
  assert.equal(blocked, true, 'direct reservation must reject incomplete billing');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.payment_transactions WHERE order_id=$1',
    [digitalOrder])).rows[0].n, 0);
  const digital = (await db.query('SELECT public.reserve_pelecard_live_order($1,$2,100000,NULL,$3) AS value',
    [digitalOrder, cashier, JSON.stringify(billing)])).rows[0].value;
  assert.equal(digital.created, true);
  const frozen = (await db.query(`SELECT p.amount,p.checkout_snapshot,b.billing_name,b.billing_identity,
    b.billing_email,b.vat_applicable FROM public.payment_transactions p
    JOIN public.payper_payment_billing_snapshots b ON b.payment_id=p.id WHERE p.id=$1`,
    [digital.id])).rows[0];
  assert.equal(Number(frozen.amount), 1000);
  assert.match(frozen.checkout_snapshot.items[0].name, /Group activity/);
  assert.equal(frozen.checkout_snapshot.items[0].customPrice, 1000);
  assert.equal(frozen.billing_name, billing.name);
  assert.equal(frozen.billing_identity, billing.identity);
  assert.equal(frozen.billing_email, billing.email);
  assert.equal(frozen.vat_applicable, true);
  const hostedId = '00000000-0000-4000-8000-000000000011';
  const hostedUrl = `https://gateway20.pelecard.biz/PaymentGW?transactionId=${hostedId}`;
  const claimed = (await db.query('SELECT * FROM public.claim_pelecard_live_init($1)', [digital.id])).rows;
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].amount_minor, 100000);
  await db.query('SELECT public.persist_pelecard_live_adapter_session($1,$2,$3,$4)',
    [digital.id, hostedId, 'mock-confirmation', hostedUrl]);
  await db.query("SELECT public.observe_pelecard_live_attempt($1,'usable','000','000',true)", [digital.id]);
  await db.query("SELECT public.finalize_pelecard_live($1,$2,'mock-approval','000',1000,'ILS')",
    [digital.id, hostedId]);
  const finalized = (await db.query('SELECT status,sale_id FROM public.payment_transactions WHERE id=$1',
    [digital.id])).rows[0];
  assert.equal(finalized.status, 'succeeded');
  assert.ok(finalized.sale_id);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.sales WHERE order_id=$1',
    [digitalOrder])).rows[0].n, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.payper_document_ledger WHERE payment_id=$1',
    [digital.id])).rows[0].n, 1);
  const invoiceFacts = (await db.query('SELECT public.freeze_payper_source($1) AS value',
    [digital.id])).rows[0].value;
  assert.equal(invoiceFacts.billing.billing_company_id, billing.identity);
  assert.equal(invoiceFacts.checkoutSnapshot.items[0].customPrice, 1000);
  const invoiceRequest = buildCreatePayperInvoice({
    paymentId: invoiceFacts.paymentId, pelecardTransactionId: invoiceFacts.pelecardTransactionId,
    amount: Number(invoiceFacts.amount), currency: invoiceFacts.currency,
    paymentCreatedAt: invoiceFacts.paymentCreatedAt, verifiedAt: invoiceFacts.verifiedAt,
    activationCutoffUtc: invoiceFacts.activationCutoffUtc,
    orderId: invoiceFacts.orderId, orderNumber: invoiceFacts.orderNumber,
    customerKind: invoiceFacts.customerKind, checkoutSnapshot: invoiceFacts.checkoutSnapshot,
    billing: invoiceFacts.billing,
  }, '123456', { terminalNumber: 'TEST', user: 'TEST', password: 'TEST' }, { sendByMail: true });
  assert.equal(invoiceRequest.PayperParameters.typeDocument, 'Invoice-Receipt');
  assert.equal(invoiceRequest.PayperParameters.DataPayper.invoice_lines[0].price_per_unit, '100000');
  assert.equal(invoiceRequest.PayperParameters.DataPayper.document_no_vat, 'false');
  await db.query("SELECT public.finalize_pelecard_live($1,$2,'mock-approval','000',1000,'ILS')",
    [digital.id, hostedId]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.sales WHERE order_id=$1',
    [digitalOrder])).rows[0].n, 1);
  current = 'cash order collection on full schema';
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
  current = 'provider-mocked cash Invoice-Receipt';
  const facts = (await db.query(`SELECT n.method,n.document_type,n.reference_document_id,
    n.check_details,n.billing,n.amount_minor,s.items,s.discount,s.receipt_number,s.sale_date
    FROM public.payper_noncard_payments n JOIN public.sales s ON s.id=n.sale_id
    WHERE n.payment_id=$1`, [collected.paymentId])).rows[0];
  const cashRequest = buildNoncardPayperRequest({ amountMinor: facts.amount_minor,
    method: facts.method, documentType: facts.document_type,
    referenceDocumentId: facts.reference_document_id,
    receiptNumber: facts.receipt_number, paidDate: facts.sale_date.toISOString().slice(0, 10),
    items: facts.items, discount: facts.discount, billing: facts.billing, check: facts.check_details },
  { terminalNumber: 'TEST', user: 'TEST', password: 'TEST' });
  assert.equal(cashRequest.trxRecordId, '');
  assert.equal(cashRequest.Uid, '');
  assert.equal(cashRequest.PayperParameters.typeDocument, 'invoice-receipt');
  assert.deepEqual(cashRequest.PayperParameters.DataPayper.receipt_lines.map(line =>
    ({ payment_type: line.payment_type, amount: line.amount })),
  [{ payment_type: 'Cash', amount: 100000 }]);
  await db.query('SELECT public.reserve_check_payper_dispatch($1)', [collected.paymentId]);
  let providerPosts = 0;
  const outcome = await dispatchNoncardPayper(cashRequest, async (_url, options) => {
    providerPosts += 1;
    assert.equal(JSON.parse(options.body).PayperParameters.DataPayper.send_by_mail, 'true');
    return new Response(JSON.stringify({ StatusCode: '000', PayperData: {
      InvoiceStatus: 'Success', InvoiceNumber: '2001',
      InvoiceLink: 'https://app.payper.co.il/public/invoice_show/2001',
    } }), { status: 200 });
  });
  assert.equal(outcome.state, 'succeeded');
  await db.query(`SELECT public.record_check_payper_outcome(
    $1,'succeeded',$2,$3,NULL,true,'000','Success',NULL)`,
  [collected.paymentId, outcome.documentNumber, outcome.documentUrl]);
  assert.equal(providerPosts, 1);
  const issued = (await db.query(`SELECT state,document_number,document_url
    FROM public.payper_document_ledger WHERE payment_id=$1`, [collected.paymentId])).rows[0];
  assert.deepEqual(issued, { state: 'succeeded', document_number: '2001',
    document_url: 'https://app.payper.co.il/public/invoice_show/2001' });
  let redispatchRejected = false;
  try { await db.query('SELECT public.reserve_check_payper_dispatch($1)', [collected.paymentId]); }
  catch (error) { redispatchRejected = /check_payper_dispatch_fence/.test(error.message); }
  assert.equal(redispatchRejected, true);
  const afterIssuance = (await db.query(`SELECT public.record_payper_order_collection(
    $1,$2,$3,'cash',100000,NULL,$4,'invoice-receipt',NULL) AS value`,
    [cashier, requestKey, order, JSON.stringify(billing)])).rows[0].value;
  assert.equal(afterIssuance.created, false);
  assert.equal(afterIssuance.paymentId, collected.paymentId);
  const settled = (await db.query('SELECT public.get_payper_order_collection($1,$2) AS value',
    [cashier, order])).rows[0].value;
  assert.equal(settled.balanceMinor, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.sales WHERE order_id=$1', [order])).rows[0].n, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.payment_transactions WHERE order_id=$1', [order])).rows[0].n, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.payper_document_ledger WHERE order_id=$1', [order])).rows[0].n, 1);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.accounting_events
    WHERE source_type='payment_transaction' AND source_id=$1`, [collected.paymentId])).rows[0].n, 1);
  assert.equal((await db.query('SELECT state FROM public.payper_document_ledger WHERE order_id=$1', [order])).rows[0].state, 'succeeded');
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
  const vatIssues = (await db.query('SELECT public.digital_order_payment_issues($1,$2,$3) AS value',
    [unknownVatOrder, cashier, JSON.stringify(billing)])).rows[0].value;
  assert.ok(vatIssues.includes('vat_required'));
  let vatReservationBlocked = false;
  try { await db.query('SELECT public.reserve_pelecard_live_order($1,$2,100000,NULL,$3)',
    [unknownVatOrder, cashier, JSON.stringify(billing)]); }
  catch (error) { vatReservationBlocked = /digital_order_not_eligible/.test(error.message); }
  assert.equal(vatReservationBlocked, true, 'missing VAT must block direct hosted reservation');
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
    const partialIssues = (await db.query('SELECT public.digital_order_payment_issues($1,$2,$3) AS value',
      [physicalOrder, cashier, JSON.stringify(billing)])).rows[0].value;
    assert.ok(partialIssues.includes('digital_partial_unsupported'));
    let fullHostedRejected = false;
    try { await db.query('SELECT public.reserve_pelecard_live_order($1,$2,100000,NULL,$3)',
      [physicalOrder, cashier, JSON.stringify(billing)]); }
    catch (error) { fullHostedRejected = /digital_order_not_eligible/.test(error.message); }
    assert.equal(fullHostedRejected, true, 'digital checkout cannot charge the original total after a partial payment');
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
    digitalOrderMockApproval: 'passed',
    cashOrderCollection: 'passed',
    physicalRemainingBalance: physicalIncluded ? 'passed' : 'not_requested' }));
  if (process.env.AUDIT_CATALOG_NAMES === '1') {
    const names = (await db.query(`SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`)).rows.map(row => row.relname);
    const functionSignatures = (await db.query(`SELECT p.oid::regprocedure::text AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' ORDER BY signature`)).rows.map(row => row.signature);
    const criticalFunctionHashes = (await db.query(`SELECT p.oid::regprocedure::text AS signature,
      md5(p.prosrc) AS hash,
      md5(regexp_replace(p.prosrc,'[[:space:]]+','','g')) AS compact_hash
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
      ('payment_checkout_snapshot_is_safe','record_payper_dispatch_outcome_v2',
       'hold_payper_source','reserve_pelecard_order_payment','finalize_pelecard_payment',
       'finalize_physical_payment','guard_check_general_register','guard_order_customer_snapshot')
      ORDER BY signature`)).rows;
    const policyNames = (await db.query(`SELECT tablename||'.'||policyname AS name
      FROM pg_policies WHERE schemaname='public' ORDER BY name`)).rows.map(row => row.name);
    const triggerNames = (await db.query(`SELECT c.relname||'.'||t.tgname AS name
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY name`)).rows.map(row => row.name);
    console.log(JSON.stringify({ tableNames: names, functionSignatures,
      criticalFunctionHashes, policyNames, triggerNames }));
  }
} catch (error) {
  console.error(`Full-schema rehearsal failed at ${current}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
