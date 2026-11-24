import { readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const pgliteBase = process.env.PGLITE_MODULE_BASE;
const { PGlite } = await import(pgliteBase ? new URL('dist/index.js', pgliteBase).href
  : '@electric-sql/pglite');
import assert from 'node:assert/strict';
const { uuid_ossp } = await import(pgliteBase ? new URL('dist/contrib/uuid_ossp.js', pgliteBase).href
  : '@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = await import(pgliteBase ? new URL('dist/contrib/pg_trgm.js', pgliteBase).href
  : '@electric-sql/pglite/contrib/pg_trgm');
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
  const hostedIncluded = migrations.some(filename =>
    basename(filename) === '202611150004_physical_hosted_emv.sql');
  const directIncluded = migrations.some(filename =>
    basename(filename) === '202611160006_direct_j4_first_response.sql');
  for (const filename of migrations) {
    current = basename(filename);
    if (current === '202611230001_verified_sale_source_only.sql') {
      // Mirror the browser/server grants observed in Production before the patch.
      await db.exec('GRANT INSERT ON public.sales TO authenticated, service_role');
    }
    await db.exec((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
  }
  current = 'verified sale source grants';
  const saleGrants = (await db.query(`SELECT
    has_table_privilege('authenticated','public.sales','INSERT') AS browser_insert,
    has_table_privilege('service_role','public.sales','INSERT') AS server_insert,
    has_function_privilege('authenticated',
      'public.complete_manual_order_payment(uuid,text,uuid,jsonb)','EXECUTE') AS legacy_rpc`)).rows[0];
  assert.deepEqual(saleGrants, { browser_insert: false, server_insert: true, legacy_rpc: false },
    'direct browser sale and legacy paid-order RPC must be closed; verified server finalizers stay available');
  const salesBeforeBypass = (await db.query('SELECT count(*)::int AS count FROM public.sales')).rows[0].count;
  let directCreditDenied = false;
  try {
    await db.exec('SET ROLE authenticated');
    await db.query(`INSERT INTO public.sales(items,total,method)
      VALUES ('[]'::jsonb,1,'אשראי')`);
  } catch (error) {
    directCreditDenied = /permission denied/.test(error.message);
  } finally {
    await db.exec('RESET ROLE');
  }
  assert.equal(directCreditDenied, true,
    'a direct authenticated SQL/PostgREST sale insert must be denied before any receipt is written');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.sales')).rows[0].count,
    salesBeforeBypass, 'the denied request must not create a sale');
  let directLegacyDenied = false;
  try {
    await db.exec('SET ROLE authenticated');
    await db.query(`SELECT public.complete_manual_order_payment(
      '00000000-0000-4000-8000-000000000001'::uuid,'מזומן',
      '00000000-0000-4000-8000-000000000002'::uuid,'{}'::jsonb)`);
  } catch (error) {
    directLegacyDenied = /permission denied/.test(error.message);
  } finally {
    await db.exec('RESET ROLE');
  }
  assert.equal(directLegacyDenied, true,
    'a direct authenticated legacy paid-order RPC call must be denied');
  current = 'landing lead ingestion with customer classification';
  const leadKey = 'a'.repeat(64);
  const leadResult = (await db.query(`SELECT public.ingest_landing_lead($1,$2,$3,$4::jsonb) AS result`,
    ['customer-type-rehearsal', leadKey, 'b'.repeat(64), JSON.stringify({
      source: 'landing_page', fullName: 'Synthetic Lead', phone: '0501234567',
      attribution: { pagePath: '/', pageUrl: 'https://example.invalid/' },
    })])).rows[0].result;
  assert.equal(leadResult.created, true, 'the landing lead RPC must still insert a lead');
  const leadType = (await db.query('SELECT customer_type FROM public.leads WHERE id=$1',
    [leadResult.leadId])).rows[0].customer_type;
  assert.equal(leadType, null, 'landing leads must remain unclassified unless explicitly classified');
  current = 'read-only optional-customer production preflight';
  await db.exec(await readFile(new URL('../../scripts/orders/optional-customer-production-preflight.sql',
    import.meta.url), 'utf8'));
  current = 'order collection on full schema';
  const cashier = '00000000-0000-4000-8000-000000000001';
  const activity = '00000000-0000-4000-8000-000000000002';
  const order = '00000000-0000-4000-8000-000000000003';
  const requestKey = '00000000-0000-4000-8000-000000000004';
  const customer = '00000000-0000-4000-8000-000000000006';
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [cashier, 'cashier@example.invalid']);
  await db.query("UPDATE public.profiles SET role='cashier' WHERE id=$1", [cashier]);
  await db.query("INSERT INTO public.activities(id,name,price_per_person) VALUES($1,'Group activity',1000)", [activity]);
  current = 'optional order customer details';
  const customerColumns = (await db.query(`SELECT attname,attnotnull FROM pg_attribute
    WHERE attrelid='public.orders'::regclass AND attname IN ('client_name','client_phone')
    AND NOT attisdropped ORDER BY attname`)).rows;
  assert.deepEqual(customerColumns, [
    { attname: 'client_name', attnotnull: false },
    { attname: 'client_phone', attnotnull: false },
  ]);
  const guestOrder = '00000000-0000-4000-8000-000000000100';
  await db.query(`INSERT INTO public.orders(id,activity_id,activity_date,num_participants,
    price_per_person,total_price) VALUES($1,$2,current_date,1,1000,1000)`, [guestOrder, activity]);
  assert.deepEqual((await db.query(`SELECT client_name,client_phone,client_email,customer_id
    FROM public.orders WHERE id=$1`, [guestOrder])).rows[0],
    { client_name: null, client_phone: null, client_email: null, customer_id: null });
  await db.query(`UPDATE public.orders SET client_name='Guest Name',client_phone='0500000000'
    WHERE id=$1`, [guestOrder]);
  assert.deepEqual((await db.query(`SELECT client_name,client_phone,client_email,customer_id
    FROM public.orders WHERE id=$1`, [guestOrder])).rows[0],
    { client_name: 'Guest Name', client_phone: '0500000000', client_email: null, customer_id: null });
  current = 'order collection on full schema';
  await db.query(`INSERT INTO public.orders(id,client_name,client_phone,client_email,organization,
    activity_id,activity_date,num_participants,price_per_person,payment_status)
    VALUES($1,'Test Group','0500000000','billing@example.invalid','Test Group',
      $2,current_date,1,1000,'לא שולם')`, [order, activity]);
  await db.query("SELECT set_config('app.test_uid',$1,false)", [cashier]);
  await db.query(`INSERT INTO public.customers(id,customer_kind,customer_type,display_name,contact_name,phone,email,
    organization_name,vat_applicable,billing_name,billing_company_id,billing_accounting_email)
    VALUES($1,'organization','גפ״ן','Test Group','Group Contact','0500000000',
    'billing@example.invalid','Test Group',true,'Test Group','123456789','')`, [customer]);
  await db.query('SELECT public.link_order_customer($1,$2,0)', [order, customer]);
  const originalType = (await db.query(`SELECT c.customer_kind,c.customer_type,
    s.customer_type AS order_type FROM public.customers c JOIN public.orders o ON o.customer_id=c.id
    JOIN public.customer_snapshots s ON s.id=o.customer_snapshot_id WHERE o.id=$1`, [order])).rows[0];
  assert.deepEqual(originalType, { customer_kind: 'organization', customer_type: 'גפ״ן', order_type: 'גפ״ן' });
  await db.query(`UPDATE public.customers SET customer_type='חברה' WHERE id=$1`, [customer]);
  const frozenType = (await db.query(`SELECT c.customer_type,s.customer_type AS order_type
    FROM public.customers c JOIN public.orders o ON o.customer_id=c.id
    JOIN public.customer_snapshots s ON s.id=o.customer_snapshot_id WHERE o.id=$1`, [order])).rows[0];
  assert.deepEqual(frozenType, { customer_type: 'חברה', order_type: 'גפ״ן' },
    'changing the card must not reclassify an existing order');
  const version = (await db.query('SELECT version FROM public.customers WHERE id=$1', [customer])).rows[0].version;
  const savedCustomer = (await db.query(`SELECT (public.save_customer(
    jsonb_build_object('customer_kind','organization','customer_type','סוכן/מפיק',
      'display_name','Test Group','vat_applicable',true),$1,$2)).customer_type AS type`,
    [customer, version])).rows[0];
  assert.equal(savedCustomer.type, 'סוכן/מפיק', 'the existing customer RPC must accept the new type');
  assert.equal((await db.query(`SELECT s.customer_type AS type FROM public.orders o
    JOIN public.customer_snapshots s ON s.id=o.customer_snapshot_id WHERE o.id=$1`, [order])).rows[0].type,
    'גפ״ן', 'customer RPC edits must not change the order snapshot');
  const initial = (await db.query('SELECT public.get_payper_order_collection($1,$2) AS value',
    [cashier, order])).rows[0].value;
  assert.equal(initial.balanceMinor, 100000);
  current = 'signed contact completion remains private and idempotent';
  const signatureRevision = '00000000-0000-4000-8000-000000000201';
  const signatureRequest = '00000000-0000-4000-8000-000000000202';
  const snapshotId = (await db.query('SELECT customer_snapshot_id FROM public.orders WHERE id=$1', [order])).rows[0].customer_snapshot_id;
  await db.query(`INSERT INTO public.order_confirmation_revisions
    (id,order_id,revision_number,snapshot,source_version,token_hash,status,created_by,expires_at,
     revision_hash,unsigned_path,unsigned_hash,signed_path,signed_hash,request_id,full_name,strokes,signed_at)
    VALUES($1,$2,1,$3::jsonb,'synthetic',$4,'signing',$5,now()+interval '7 days',
     $6,$7,$8,$9,$10,$11,'Synthetic Signer','[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb,now())`,
    [signatureRevision,order,JSON.stringify({data:{customer_snapshot_id:snapshotId}}),
      'a'.repeat(64),cashier,'b'.repeat(64),signatureRevision+'/unsigned.pdf',
      'c'.repeat(64),signatureRevision+'/signed.pdf','d'.repeat(64),signatureRequest]);
  const completion = {phone:'0501234567'};
  const recorded = (await db.query('SELECT public.record_order_signature_response($1,$2,$3::jsonb) AS result',
    [signatureRevision,signatureRequest,JSON.stringify(completion)])).rows[0].result;
  assert.deepEqual(recorded, {recorded:true,leadLinkStatus:'unmatched'});
  assert.equal((await db.query('SELECT completed_at FROM public.order_signature_responses WHERE revision_id=$1',
    [signatureRevision])).rows[0].completed_at,null,'a claimed but unfinished signature stays hidden');
  await db.query("UPDATE public.order_confirmation_revisions SET status='signed' WHERE id=$1",[signatureRevision]);
  await db.query('SELECT public.record_order_signature_response($1,$2,$3::jsonb)',
    [signatureRevision,signatureRequest,JSON.stringify(completion)]);
  assert.ok((await db.query('SELECT completed_at FROM public.order_signature_responses WHERE revision_id=$1',
    [signatureRevision])).rows[0].completed_at,'only the finished signature exposes contact evidence');
  assert.deepEqual((await db.query('SELECT customer_id,lead_id,details FROM public.order_signature_responses WHERE revision_id=$1',
    [signatureRevision])).rows[0],{customer_id:customer,lead_id:null,details:completion});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.order_signature_responses WHERE revision_id=$1',
    [signatureRevision])).rows[0].n,1);
  let responseConflict = false;
  try {await db.query('SELECT public.record_order_signature_response($1,$2,$3::jsonb)',
    [signatureRevision,signatureRequest,JSON.stringify({phone:'0509999999'})]);}
  catch(error){responseConflict=/revision_conflict/.test(error.message);}
  assert.equal(responseConflict,true,'a replay cannot rewrite signed contact evidence');
  const responsePrivileges=(await db.query(`SELECT
    has_table_privilege('authenticated','public.order_signature_responses','INSERT') AS browser_insert,
    has_function_privilege('authenticated','public.record_order_signature_response(uuid,uuid,jsonb)','EXECUTE') AS browser_rpc`)).rows[0];
  assert.deepEqual(responsePrivileges,{browser_insert:false,browser_rpc:false});
  current = 'order collection on full schema';
  const outsider = '00000000-0000-4000-8000-000000000008';
  let forbidden = false;
  try { await db.query('SELECT public.get_payper_order_collection($1,$2)', [outsider, order]); }
  catch (error) { forbidden = /order_collection_forbidden/.test(error.message); }
  assert.equal(forbidden, true, 'an actor without an application profile cannot read collection');
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [outsider, 'instructor@example.invalid']);
  await db.query("UPDATE public.profiles SET role='instructor' WHERE id=$1", [outsider]);
  const instructorView = (await db.query('SELECT public.get_payper_order_collection($1,$2) AS value',
    [outsider, order])).rows[0].value;
  assert.equal(instructorView.orderId, order, 'current physical role policy permits read-only status');
  const billing = { kind: 'organization', name: 'Test Group', identity: '123456789', email: 'billing@example.invalid' };
  const savedBilling = (await db.query('SELECT public.get_payper_billing_defaults($1,$2) AS value',
    [order, cashier])).rows[0].value;
  assert.deepEqual(savedBilling, billing,
    'a blank optional accounting email must use the linked customer contact email');
  current = 'digital order eligibility and immutable invoice source';
  const digitalOrder = '00000000-0000-4000-8000-000000000010';
  await db.query('UPDATE public.payper_dispatch_control SET activation_cutoff_utc=statement_timestamp() WHERE singleton');
  await db.query(`INSERT INTO public.orders(id,client_name,client_phone,client_email,organization,
    activity_id,activity_date,num_participants,price_per_person,payment_status)
    VALUES($1,'Test Group','0500000000','billing@example.invalid','Test Group',
      $2,current_date,1,1000,'לא שולם')`, [digitalOrder, activity]);
  await db.query('SELECT public.link_order_customer($1,$2,0)', [digitalOrder, customer]);
  const linkedDigitalBilling = (await db.query(
    'SELECT public.get_payper_billing_defaults($1,$2) AS value',
    [digitalOrder, cashier])).rows[0].value;
  assert.deepEqual(linkedDigitalBilling, billing);
  const issues = (await db.query('SELECT public.digital_order_payment_issues($1,$2,$3) AS value',
    [digitalOrder, cashier, JSON.stringify(linkedDigitalBilling)])).rows[0].value;
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
    [digitalOrder, cashier, JSON.stringify(linkedDigitalBilling)])).rows[0].value;
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
  let mismatchedBillingBlocked = false;
  try { await db.query(`SELECT public.record_payper_order_collection(
    $1,gen_random_uuid(),$2,'cash',100000,NULL,$3,'invoice-receipt',NULL)`,
    [cashier, order, JSON.stringify({ ...billing, name: 'Wrong Customer' })]); }
  catch (error) { mismatchedBillingBlocked = /order_billing_review_required/.test(error.message); }
  assert.equal(mismatchedBillingBlocked, true, 'cash direct API must use the frozen customer billing');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.sales WHERE order_id=$1',
    [order])).rows[0].n, 0);
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
    n.check_details,n.billing,n.amount_minor,s.items,s.discount,s.receipt_number,s.sale_date,
    l.source_facts
    FROM public.payper_noncard_payments n JOIN public.sales s ON s.id=n.sale_id
    JOIN public.payper_document_ledger l ON l.payment_id=n.payment_id
    WHERE n.payment_id=$1`, [collected.paymentId])).rows[0];
  const cashRequest = buildNoncardPayperRequest({ amountMinor: facts.amount_minor,
    method: facts.method, documentType: facts.document_type,
    referenceDocumentId: facts.reference_document_id,
    receiptNumber: facts.receipt_number, paidDate: facts.sale_date.toISOString().slice(0, 10),
    items: facts.items, discount: facts.discount, billing: facts.billing,
    vatApplicable: facts.source_facts.vatApplicable, check: facts.check_details },
  { terminalNumber: 'TEST', user: 'TEST', password: 'TEST' });
  assert.equal(cashRequest.trxRecordId, '');
  assert.equal(cashRequest.Uid, '');
  assert.equal(cashRequest.PayperParameters.typeDocument, 'Invoice-Receipt');
  assert.deepEqual(cashRequest.PayperParameters.DataPayper.receipt_lines.map(line =>
    ({ payment_type: line.payment_type, amount: line.amount })),
  [{ payment_type: 'Cash', amount: '100000' }]);
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
  } catch (error) { rejected = /order_balance_mismatch|order_accounting_review_required/.test(error.message); }
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
  let cashVatBlocked = false;
  try { await db.query(`SELECT public.record_payper_order_collection(
    $1,gen_random_uuid(),$2,'cash',100000,NULL,$3,'invoice-receipt',NULL)`,
    [cashier, unknownVatOrder, JSON.stringify(billing)]); }
  catch (error) { cashVatBlocked = /order_billing_or_vat_review_required/.test(error.message); }
  assert.equal(cashVatBlocked, true, 'missing VAT must block payment and sale');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.sales WHERE order_id=$1',
    [unknownVatOrder])).rows[0].n, 0);
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
    const physicalBilling = (await db.query(
      'SELECT billing_snapshot FROM public.physical_payment_intents WHERE payment_id=$1',
      [physical.paymentId])).rows[0].billing_snapshot;
    assert.equal(physicalBilling.email, billing.email,
      'physical EMV must use the saved contact email when accounting email is blank');
    if (hostedIncluded) {
      current = 'hosted EMV exact payment and document association on combined schema';
      const hostedOrder = '00000000-0000-4000-8000-000000000012';
      await db.query(`INSERT INTO public.orders(id,client_name,client_phone,client_email,organization,
        activity_id,activity_date,num_participants,price_per_person,payment_status)
        VALUES($1,'Synthetic Hosted','0500000000','billing@example.invalid','Test Group',
          $2,current_date,1,1000,'לא שולם')`, [hostedOrder, activity]);
      await db.query('SELECT public.link_order_customer($1,$2,0)', [hostedOrder, customer]);
      await db.query("UPDATE public.physical_terminal_devices SET enabled=false,cash_register_code=NULL WHERE register_number='003'");
      await db.query("UPDATE public.physical_terminal_devices SET enabled=true,cash_register_code='GENERAL' WHERE register_number='004'");
      const pending = (await db.query(`SELECT public.reserve_physical_order_payment(
        $1,gen_random_uuid(),'GENERAL',$2,100000) AS value`, [cashier, hostedOrder])).rows[0].value;
      assert.equal((await db.query('SELECT public.claim_physical_hosted_init($1) AS value',
        [pending.paymentId])).rows[0].value, true);
      const hostedId = '11111111-1111-4111-8111-111111111111';
      const redirect = `https://gateway21.pelecard.biz/PaymentGW?transactionId=${hostedId}`;
      await db.query('SELECT public.persist_physical_hosted_session($1,$2,$3,$4)',
        [pending.paymentId, hostedId, 'synthetic-confirmation', redirect]);
      await db.query(`SELECT public.observe_physical_result($1,$2::jsonb)`, [pending.paymentId,
        JSON.stringify({ status: 'approved', intentId: pending.paymentId,
          merchantTerminal: '2814926015', register: '004', amountMinor: 100000,
          transactionId: '12345', approvalId: '123456', uid: 'uid123' })]);
      const completed = (await db.query('SELECT public.finalize_physical_payment($1) AS value',
        [pending.paymentId])).rows[0].value;
      assert.equal(completed.state, 'succeeded');
      const officialUrl = 'https://app.payper.co.il/public/invoice_show/595170';
      const record = 'SELECT public.record_physical_hosted_document($1,$2,$3,$4) AS value';
      assert.equal((await db.query(record, [pending.paymentId, '595170', officialUrl, '595170']))
        .rows[0].value, true);
      assert.equal((await db.query(record, [pending.paymentId, '595170', officialUrl, '595170']))
        .rows[0].value, true);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.payper_document_ledger WHERE payment_id=$1 AND state=$2',
        [pending.paymentId, 'succeeded'])).rows[0].n, 1);
      if (directIncluded) {
        current = 'direct J4 first response and invoice association on combined schema';
        const directOrder = '00000000-0000-4000-8000-000000000016';
        await db.query(`INSERT INTO public.orders(id,client_name,client_phone,client_email,organization,
          activity_id,activity_date,num_participants,price_per_person,payment_status)
          VALUES($1,'Synthetic Direct','0500000000','billing@example.invalid','Test Group',
            $2,current_date,1,15,'לא שולם')`, [directOrder, activity]);
        await db.query('SELECT public.link_order_customer($1,$2,0)', [directOrder, customer]);
        const direct = (await db.query(`SELECT public.reserve_physical_order_payment(
          $1,gen_random_uuid(),'GENERAL',$2,1500) AS value`, [cashier, directOrder])).rows[0].value;
        assert.equal((await db.query('SELECT public.claim_physical_dispatch($1) AS value',
          [direct.paymentId])).rows[0].value, true);
        assert.equal((await db.query('SELECT public.claim_physical_dispatch($1) AS value',
          [direct.paymentId])).rows[0].value, false);
        assert.equal((await db.query('SELECT public.list_physical_worker_intents() AS value'))
          .rows[0].value.some(row => row.paymentId === direct.paymentId), false,
        'overlapping cron must not inspect an in-flight J4 call');
        const source = (await db.query('SELECT public.get_physical_direct_source($1) AS value',
          [direct.paymentId])).rows[0].value;
        assert.equal(source.amountMinor, 1500);
        assert.equal(source.register, '004');
        const evidence = { payment: { transactionId: '12346', amountMinor: 1500 },
          document: { state: 'succeeded', status: 'Success', number: '200005',
            url: 'https://app.payper.co.il/public/invoice_show/595171',
            systemId: '595171', documentId: '551' } };
        let cardLeakBlocked = false;
        try {
          await db.query('SELECT public.record_physical_first_response($1,$2::jsonb)',
            [direct.paymentId, JSON.stringify({ ...evidence, pan: 'synthetic' })]);
        } catch (error) { cardLeakBlocked = /physical_first_response_invalid/.test(error.message); }
        assert.equal(cardLeakBlocked, true, 'first response must reject unknown card fields');
        assert.equal((await db.query('SELECT public.record_physical_first_response($1,$2::jsonb) AS value',
          [direct.paymentId, JSON.stringify(evidence)])).rows[0].value, true);
        assert.equal((await db.query('SELECT public.record_physical_first_response($1,$2::jsonb) AS value',
          [direct.paymentId, JSON.stringify(evidence)])).rows[0].value, true);
        let changedResponseBlocked = false;
        try {
          await db.query('SELECT public.record_physical_first_response($1,$2::jsonb)',
            [direct.paymentId, JSON.stringify({ ...evidence, payment: {
              ...evidence.payment, transactionId: '99999' } })]);
        } catch (error) { changedResponseBlocked = /physical_first_response_conflict/.test(error.message); }
        assert.equal(changedResponseBlocked, true, 'first provider response must be immutable');
        const saved = (await db.query('SELECT public.get_physical_worker_intent($1) AS value',
          [direct.paymentId])).rows[0].value;
        assert.equal(saved.firstResponse.document.number, '200005');
        await db.query('SELECT public.observe_physical_result($1,$2::jsonb)', [direct.paymentId,
          JSON.stringify({ status: 'approved', intentId: direct.paymentId,
            merchantTerminal: '2814926015', register: '004', amountMinor: 1500,
            transactionId: '12346', approvalId: 'auth-direct-1', uid: 'uid-direct-1' })]);
        const final = (await db.query('SELECT public.finalize_physical_payment($1) AS value',
          [direct.paymentId])).rows[0].value;
        assert.equal(final.orderId, directOrder);
        assert.equal((await db.query(`SELECT verified_amount_minor AS amount
          FROM public.physical_payment_intents WHERE payment_id=$1`,
          [direct.paymentId])).rows[0].amount, 1500);
        assert.equal((await db.query('SELECT public.list_physical_worker_intents() AS value'))
          .rows[0].value.some(row => row.paymentId === direct.paymentId && row.state === 'succeeded'),
        true, 'worker must recover interrupted invoice association');
        assert.equal((await db.query('SELECT public.record_physical_direct_document($1) AS value',
          [direct.paymentId])).rows[0].value, true);
        assert.equal((await db.query('SELECT public.record_physical_direct_document($1) AS value',
          [direct.paymentId])).rows[0].value, true);
        const document = (await db.query(`SELECT document_number,physical_document_id,state
          FROM public.payper_document_ledger WHERE payment_id=$1`, [direct.paymentId])).rows[0];
        assert.deepEqual(document, { document_number: '200005', physical_document_id: '551',
          state: 'succeeded' });
      }
    }
  }
  current = 'read-only order financial badges on full schema';
  const badgeOrder = '00000000-0000-4000-8000-000000000091';
  await db.query(`INSERT INTO public.orders(id,client_name,client_phone,client_email,
    activity_id,activity_date,num_participants,price_per_person,payment_status)
    VALUES($1,'Badge fixture','0500000000','badge@example.invalid',$2,current_date,1,1000,'לא שולם')`,
  [badgeOrder, activity]);
  const badge = async () => {
    await db.query("SELECT set_config('app.test_role','authenticated',false)");
    await db.query("SELECT set_config('app.test_uid',$1,false)", [cashier]);
    try { return (await db.query('SELECT public.get_order_financial_badges(ARRAY[$1::uuid]) AS value',
      [badgeOrder])).rows[0].value[0]; }
    finally { await db.query("SELECT set_config('app.test_role','service_role',false)"); }
  };
  assert.equal((await badge()).state, 'unpaid');
  const badgePayment = '00000000-0000-4000-8000-000000000092';
  await db.query(`INSERT INTO public.payment_transactions(id,provider,operation,order_id,amount,
    currency,status,idempotency_key,checkout_snapshot,created_by)
    VALUES($1,'manual_cash','payment',$2,400,'ILS','succeeded','badge-partial',
      '{"schema_version":1,"items":[]}'::jsonb,$3)`, [badgePayment, badgeOrder, cashier]);
  const badgeSale = (await db.query(`INSERT INTO public.sales(items,total,method,order_id,
    payment_transaction_id,created_by) VALUES('[]'::jsonb,400,'מזומן',$1,$2,$3)
    RETURNING id`, [badgeOrder, badgePayment, cashier])).rows[0].id;
  await db.query('UPDATE public.payment_transactions SET sale_id=$1 WHERE id=$2',
    [badgeSale, badgePayment]);
  assert.equal((await badge()).state, 'partial',
    'a stale unpaid order label cannot hide the verified remaining balance');
  await db.query("UPDATE public.orders SET payment_status='שולם חלקית' WHERE id=$1", [badgeOrder]);
  assert.deepEqual(await badge(), { orderId: badgeOrder, state: 'partial',
    totalMinor: 100000, paidMinor: 40000, balanceMinor: 60000 });
  const uncertainBadgePayment = '00000000-0000-4000-8000-000000000093';
  await db.query(`INSERT INTO public.payment_transactions(id,provider,operation,order_id,amount,
    currency,status,idempotency_key,checkout_snapshot,created_by)
    VALUES($1,'pelecard','payment',$2,600,'ILS','initiated','badge-uncertain',
      '{"schema_version":1,"items":[]}'::jsonb,$3)`, [uncertainBadgePayment, badgeOrder, cashier]);
  assert.equal((await badge()).state, 'review', 'an initiated charge must block collection');
  await db.query("UPDATE public.payment_transactions SET status='failed' WHERE id=$1",
    [uncertainBadgePayment]);
  assert.equal((await badge()).state, 'partial');
  const balancePayment = '00000000-0000-4000-8000-000000000094';
  await db.query(`INSERT INTO public.payment_transactions(id,provider,operation,order_id,amount,
    currency,status,idempotency_key,checkout_snapshot,created_by)
    VALUES($1,'manual_cash','payment',$2,600,'ILS','succeeded','badge-balance',
      '{"schema_version":1,"items":[]}'::jsonb,$3)`, [balancePayment, badgeOrder, cashier]);
  const balanceSale = (await db.query(`INSERT INTO public.sales(items,total,method,order_id,
    payment_transaction_id,created_by) VALUES('[]'::jsonb,600,'מזומן',$1,$2,$3)
    RETURNING id`, [badgeOrder, balancePayment, cashier])).rows[0].id;
  await db.query('UPDATE public.payment_transactions SET sale_id=$1 WHERE id=$2',
    [balanceSale, balancePayment]);
  await db.query("UPDATE public.orders SET payment_status='לא שולם' WHERE id=$1", [badgeOrder]);
  assert.equal((await badge()).state, 'paid',
    'a verified zero balance must display paid despite the stale order label');
  await db.query("UPDATE public.orders SET payment_status='פלאקארד' WHERE id=$1", [badgeOrder]);
  assert.equal((await badge()).state, 'paid');
  await db.query(`INSERT INTO public.payment_transactions(provider,operation,order_id,
    parent_transaction_id,amount,currency,status,idempotency_key,checkout_snapshot,created_by)
    VALUES('manual_cash','refund',$1,$2,600,'ILS','refunded','badge-refund',
      '{"schema_version":1,"items":[]}'::jsonb,$3)`, [badgeOrder, balancePayment, cashier]);
  assert.equal((await badge()).state, 'partial', 'completed refunds determine the outstanding balance');
  await db.query("UPDATE public.orders SET payment_status='שולם חלקית' WHERE id=$1", [badgeOrder]);
  assert.deepEqual(await badge(), { orderId: badgeOrder, state: 'partial',
    totalMinor: 100000, paidMinor: 40000, balanceMinor: 60000 });
  await db.query(`INSERT INTO public.payment_transactions(provider,operation,order_id,
    parent_transaction_id,amount,currency,status,idempotency_key,checkout_snapshot,created_by)
    VALUES('manual_cash','void',$1,$2,400,'ILS','voided','badge-void',
      '{"schema_version":1,"items":[]}'::jsonb,$3)`, [badgeOrder, badgePayment, cashier]);
  assert.equal((await badge()).state, 'unpaid', 'completed voids determine the outstanding balance');
  await db.query("UPDATE public.orders SET payment_status='לא שולם' WHERE id=$1", [badgeOrder]);
  assert.deepEqual(await badge(), { orderId: badgeOrder, state: 'unpaid',
    totalMinor: 100000, paidMinor: 0, balanceMinor: 100000 });
  await db.query("SELECT set_config('app.test_role','authenticated',false)");
  await db.query("SELECT set_config('app.test_uid',$1,false)", [cashier]);
  let oversizedBadgeQueryBlocked = false;
  try { await db.query('SELECT public.get_order_financial_badges(array_fill($1::uuid,ARRAY[101]))',
    [badgeOrder]); }
  catch (error) { oversizedBadgeQueryBlocked = /order_financial_badges_invalid/.test(error.message); }
  assert.equal(oversizedBadgeQueryBlocked, true);
  await db.query("SELECT set_config('app.test_role','anon',false)");
  let anonymousBadgeQueryBlocked = false;
  try { await db.query('SELECT public.get_order_financial_badges(ARRAY[$1::uuid])', [badgeOrder]); }
  catch (error) { anonymousBadgeQueryBlocked = /order_financial_badges_forbidden/.test(error.message); }
  assert.equal(anonymousBadgeQueryBlocked, true);
  const unrelatedInstructor = '00000000-0000-4000-8000-000000000095';
  await db.query("SELECT set_config('app.test_role','service_role',false)");
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',
    [unrelatedInstructor, 'unrelated-instructor@example.invalid']);
  await db.query("SELECT set_config('app.test_role','authenticated',false)");
  await db.query("SELECT set_config('app.test_uid',$1,false)", [unrelatedInstructor]);
  assert.deepEqual((await db.query('SELECT public.get_order_financial_badges(ARRAY[$1::uuid]) AS value',
    [badgeOrder])).rows[0].value, [],
  'an instructor cannot inspect the amount or payment state of another order');
  await db.query("SELECT set_config('app.test_role','service_role',false)");
  if (files.some(name => name.includes('rivhit_journal_outbox_disabled'))) {
    const gate = (await db.query(`SELECT capture_enabled,posting_enabled,cutover_at
      FROM public.rivhit_journal_control`)).rows[0];
    assert.deepEqual(gate, { capture_enabled: false, posting_enabled: false,
      cutover_at: null },
    'the prepared journal migration must remain incapable of posting');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.rivhit_journal_approved_mappings')).rows[0].n, 0,
      'no financial mapping may be approved in the preparation migration');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.rivhit_journal_sources')).rows[0].n, 0,
      'existing and rehearsal Payper documents must not be captured retroactively');
    let disabledStageRejected = false;
    let disabledStageError = '';
    try {
      await db.query(`SELECT public.stage_rivhit_journal_entry(
        '00000000-0000-4000-8000-000000000001'::uuid,'gross','v1-test','test',
        '{}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000000',0)`);
    } catch (error) { disabledStageError = error.message; disabledStageRejected = /rivhit_journal_mapping_disabled/.test(error.message); }
    assert.equal(disabledStageRejected, true, `unapproved journal mapping must be rejected: ${disabledStageError}`);
    let disabledReserveRejected = false;
    try {
      await db.query(`SELECT public.reserve_rivhit_journal_entry(
        '00000000-0000-4000-8000-000000000001'::uuid)`);
    } catch (error) { disabledReserveRejected = /rivhit_journal_posting_disabled/.test(error.message); }
    assert.equal(disabledReserveRejected, true, 'journal posting must be rejected in the database');
    const privileges = (await db.query(`SELECT
      has_function_privilege('authenticated',
        'public.reserve_rivhit_journal_entry(uuid)','EXECUTE') AS user_can_reserve,
      has_function_privilege('anon',
        'public.stage_rivhit_journal_entry(uuid,text,text,text,jsonb,text,numeric)','EXECUTE') AS anon_can_stage`)).rows[0];
    assert.deepEqual(privileges, { user_can_reserve: false, anon_can_stage: false },
      'only the service role may use journal transitions');
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
    physicalRemainingBalance: physicalIncluded ? 'passed' : 'not_requested',
    hostedDocumentAssociation: hostedIncluded ? 'passed' : 'not_requested',
    directFirstResponse: directIncluded ? 'passed' : 'not_requested' }));
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
