// Disposable in-memory PostgreSQL only. No production connection or credentials.
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const modulePath = process.env.PAYPER_PGLITE_MODULE ||
  resolve(root, '../../.tmp/payment-db/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const extRoot = join(dirname(modulePath), 'contrib');
const { uuid_ossp } = await import(pathToFileURL(join(extRoot, 'uuid_ossp.js')).href);
const { pg_trgm } = await import(pathToFileURL(join(extRoot, 'pg_trgm.js')).href);
const db = new PGlite({ extensions: { uuid_ossp, pg_trgm } });
const read = path => readFile(join(root, path), 'utf8');
let stage = 'fixture';
try {
  await db.exec(await read('scripts/payments/fixture.sql'));
  await db.exec(await read('scripts/payments/assertions.sql'));
  const names = (await readdir(join(root, 'supabase/migrations')))
    .filter(name => name.endsWith('.sql')).sort();
  for (const name of names) {
    stage = name;
    await db.exec(await read('supabase/migrations/' + name));
  }
  stage = '37 POS SQL assertions';
  await db.exec((await read('supabase/tests/pos_pelecard.sql'))
    .replace('CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;',
      '-- Local assertion compatibility harness loaded above.'));
  console.log('PASS 37/37 POS SQL assertions on disposable PostgreSQL');
  stage = 'payper automatic control assertions';
  const scalar = async sql => (await db.query(sql)).rows[0];
  assert.deepEqual(await scalar(`SELECT enabled,dispatch_mode,dispatch_remaining,
    activation_cutoff_utc,canary_payment_id FROM public.payper_dispatch_control`), {
    enabled: false, dispatch_mode: 'disabled', dispatch_remaining: 0,
    activation_cutoff_utc: null, canary_payment_id: null,
  });
  await db.exec(`SELECT set_config('request.jwt.claim.role','service_role',false);
    INSERT INTO auth.users(id,email) VALUES
    ('92000000-0000-4000-8000-000000000001','payper-admin@example.test');
    UPDATE public.profiles SET role='admin'
    WHERE id='92000000-0000-4000-8000-000000000001';`);
  const actor = '92000000-0000-4000-8000-000000000001';
  const fail = async (sql, code) => assert.rejects(() => db.query(sql), e => e.message.includes(code));
  await fail(`SELECT public.enable_payper_continuous('${actor}')`, 'payper_continuous_not_ready');
  const cutoff = (await scalar(`SELECT public.activate_payper_new_payments('${actor}') AS value`)).value;
  assert.ok(cutoff);
  assert.deepEqual(await scalar(`SELECT enabled,dispatch_mode,dispatch_remaining,canary_payment_id
    FROM public.payper_dispatch_control`), {
    enabled: true, dispatch_mode: 'canary', dispatch_remaining: 1, canary_payment_id: null,
  });
  await fail(`SELECT public.activate_payper_new_payments('${actor}')`, 'payper_activation_already_recorded');
  await fail(`SELECT public.target_payper_canary('${actor}',gen_random_uuid())`, 'payper_canary_payment_invalid');
  await fail(`UPDATE public.payper_dispatch_control SET activation_cutoff_utc=now()-interval '1 day'`,
    'payper_activation_cutoff_immutable');
  await db.exec(`INSERT INTO public.products(id,name,price,status)
    VALUES('92000000-0000-4000-8000-000000000002','Synthetic taxable item',3,'פעיל');`);
  const makePos = async (key, record) => {
    const payment = (await scalar(`SELECT public.reserve_pos_pelecard('${actor}',
      '${key}','[{"kind":"product","id":"92000000-0000-4000-8000-000000000002","qty":1}]',
      NULL,'{"kind":"person","name":"Synthetic Customer","identity":"000000018","email":"synthetic@example.test"}')
      AS value`)).value.paymentId;
    const claim = await scalar(`SELECT * FROM public.claim_pos_pelecard_init('${payment}')`);
    assert.equal(claim.amount_minor, 300);
    await db.query(`SELECT public.persist_pos_pelecard_session('${payment}','${record}',
      'synthetic-key','https://gateway20.pelecard.biz/PaymentGW?transactionId=${record}')`);
    await db.query(`SELECT public.observe_pos_pelecard('${payment}','usable','000','000',true)`);
    await db.query(`SELECT public.finalize_pos_pelecard('${payment}','synthetic-approval')`);
    return payment;
  };
  const firstKey = '92000000-0000-4000-8000-000000000003';
  const firstRecord = '92000000-0000-4000-8000-000000000004';
  const first = (await scalar(`SELECT public.reserve_pos_pelecard('${actor}',
    '${firstKey}','[{"kind":"product","id":"92000000-0000-4000-8000-000000000002","qty":1}]',
    NULL,'{"kind":"person","name":"Synthetic Customer","identity":"000000018","email":"synthetic@example.test"}')
    AS value`)).value.paymentId;
  await db.query(`SELECT public.target_payper_canary('${actor}','${first}')`);
  await db.query(`SELECT public.claim_pos_pelecard_init('${first}')`);
  await db.query(`SELECT public.persist_pos_pelecard_session('${first}','${firstRecord}',
    'synthetic-key','https://gateway20.pelecard.biz/PaymentGW?transactionId=${firstRecord}')`);
  await db.query(`SELECT public.observe_pos_pelecard('${first}','usable','000','000',true)`);
  await db.query(`SELECT public.finalize_pos_pelecard('${first}','synthetic-approval')`);
  assert.equal((await scalar(`SELECT state FROM public.payper_document_ledger WHERE payment_id='${first}'`)).state,'eligible');
  await db.query(`SELECT public.freeze_payper_source('${first}')`);
  stage = 'classified pre-dispatch hold';
  await fail(`SELECT public.hold_payper_source('${first}','private-provider-error')`, 'payper_safe_code_required');
  await db.query(`SELECT public.hold_payper_source('${first}','provider_credentials_rejected')`);
  assert.deepEqual(await scalar(`SELECT state,reconciliation_code,dispatch_reserved_at
    FROM public.payper_document_ledger WHERE payment_id='${first}'`), {
    state: 'source_blocked', reconciliation_code: 'provider_credentials_rejected',
    dispatch_reserved_at: null,
  });
  stage = 'targeted held-source recovery';
  await fail(`SELECT public.rearm_payper_source_after_reconciliation('${first}','${actor}','1000000001')`,
    'payper_recovery_fence');
  await db.query(`SELECT public.stop_payper_dispatch('${actor}')`);
  await fail(`SELECT public.rearm_payper_source_after_reconciliation('${first}','${actor}','1000000001')`,
    'payper_reconciliation_evidence_required');
  await db.query(`SELECT public.note_payper_reconciliation('${first}','${actor}','1000000001',
    'Synthetic read-only provider confirmation; no document request')`);
  await fail(`SELECT public.rearm_payper_source_after_reconciliation('${first}','${actor}','100002')`,
    'payper_reconciliation_evidence_required');
  await db.query(`SELECT public.rearm_payper_source_after_reconciliation('${first}','${actor}','1000000001')`);
  assert.deepEqual(await scalar(`SELECT state,reconciliation_code,
    reconciliation_evidence->>'previousCode' AS previous_code,dispatch_reserved_at
    FROM public.payper_document_ledger WHERE payment_id='${first}'`), {
    state: 'source_frozen', reconciliation_code: null,
    previous_code: 'provider_credentials_rejected', dispatch_reserved_at: null,
  });
  await fail(`SELECT public.rearm_payper_source_after_reconciliation('${first}','${actor}','1000000001')`,
    'payper_recovery_fence');
  // A second pre-dispatch hold cannot reuse the same admin evidence to rearm.
  await db.query(`UPDATE public.payper_document_ledger SET state='source_blocked',
    reconciliation_code='provider_credentials_rejected' WHERE payment_id='${first}'`);
  await fail(`SELECT public.rearm_payper_source_after_reconciliation('${first}','${actor}','1000000001')`,
    'payper_reconciliation_evidence_required');
  await db.query(`UPDATE public.payper_document_ledger SET state='source_frozen',
    reconciliation_code=NULL WHERE payment_id='${first}'`);
  // Local-only simulation of the later, separately authorized canary switch.
  await db.query(`UPDATE public.payper_dispatch_control SET enabled=true WHERE singleton
    AND dispatch_mode='canary' AND canary_payment_id='${first}' AND dispatch_remaining=1`);
  const prior = await makePos('92000000-0000-4000-8000-000000000005',
    '92000000-0000-4000-8000-000000000006');
  await db.query(`SELECT public.freeze_payper_source('${prior}')`);
  stage = 'non-target canary reservation';
  await fail(`SELECT public.reserve_payper_dispatch('${prior}','100002')`, 'payper_dispatch_limit_reached');
  stage = 'target canary reservation';
  await db.query(`SELECT public.reserve_payper_dispatch('${first}','1000000001')`);
  assert.equal((await scalar('SELECT dispatch_remaining FROM public.payper_dispatch_control')).dispatch_remaining,0);
  stage = 'duplicate canary reservation';
  await fail(`SELECT public.reserve_payper_dispatch('${first}','1000000001')`, 'payper_dispatch_fence');
  await fail(`SELECT public.enable_payper_continuous('${actor}')`, 'payper_continuous_not_ready');
  await db.query(`SELECT public.stop_payper_dispatch('${actor}')`);
  await db.query(`SELECT public.record_payper_dispatch_outcome('${first}','succeeded','900001',
    'https://app.payper.co.il/public/invoice_show/900001?ak=synthetic',NULL)`);
  const canaryCutoff = (await scalar('SELECT public.payper_effective_cutoff() AS value')).value;
  await db.query('SELECT pg_sleep(0.01)');
  await db.query("SELECT set_config('request.jwt.claim.role','authenticated',false)");
  await fail(`SELECT public.enable_payper_continuous('${actor}')`, 'administrator_required');
  await db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
  await db.query(`SELECT public.enable_payper_continuous('${actor}')`);
  assert.deepEqual(await scalar(`SELECT enabled,dispatch_mode,dispatch_remaining,canary_payment_id
    FROM public.payper_dispatch_control`), {
    enabled: true, dispatch_mode: 'continuous', dispatch_remaining: 0, canary_payment_id: null,
  });
  assert.ok((await scalar('SELECT public.payper_effective_cutoff() AS value')).value > canaryCutoff);
  await fail(`SELECT public.enable_payper_continuous('${actor}')`, 'payper_continuous_not_ready');
  assert.deepEqual((await db.query('SELECT public.list_payper_dispatch_candidates() AS id')).rows, []);
  await fail(`SELECT public.reserve_payper_dispatch('${prior}','100002')`, 'payper_activation_fence');
  const second = await makePos('92000000-0000-4000-8000-000000000019',
    '92000000-0000-4000-8000-000000000020');
  await db.query(`SELECT public.freeze_payper_source('${second}')`);
  await db.query(`SELECT public.reserve_payper_dispatch('${second}','100002')`);
  await fail(`SELECT public.reserve_payper_dispatch('${second}','100002')`, 'payper_dispatch_fence');
  assert.equal((await scalar(`SELECT state FROM public.payper_document_ledger WHERE payment_id='${second}'`)).state,
    'dispatch_reserved');
  await db.query(`UPDATE public.payper_document_ledger
    SET updated_at=now()-interval '3 minutes' WHERE payment_id='${second}'`);
  stage = 'admin exception visibility';
  await db.exec(`SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.role','authenticated',false);
    SELECT set_config('request.jwt.claim.sub','${actor}',false);`);
  assert.equal(Number((await scalar(`SELECT count(*) AS count FROM public.payper_accounting_exceptions`)).count),2);
  assert.equal(Number((await scalar(`SELECT count(*) AS count FROM public.payper_accounting_exceptions
    WHERE actionable`)).count),1);
  await db.exec(`SELECT set_config('request.jwt.claim.sub','',false);`);
  assert.equal(Number((await scalar(`SELECT count(*) AS count FROM public.payper_accounting_exceptions`)).count),0);
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.role','service_role',false);`);
  await db.query(`SELECT public.stop_payper_dispatch('${actor}')`);
  assert.equal((await scalar('SELECT enabled FROM public.payper_dispatch_control')).enabled, false);
  stage = 'private provider response diagnostics';
  await db.query(`SELECT public.record_payper_dispatch_outcome_v2('${second}',
    'reconciliation_required',NULL,NULL,'provider_document_rejected',
    true,'000','Error','catalog_id must be numeric')`);
  assert.deepEqual(await scalar(`SELECT response_received,provider_status_code,
    invoice_status,invoice_error FROM public.payper_provider_response_diagnostics
    WHERE payment_id='${second}'`), {
    response_received: true, provider_status_code: '000', invoice_status: 'Error',
    invoice_error: 'catalog_id must be numeric',
  });
  await fail(`SELECT public.record_payper_dispatch_outcome_v2('${second}',
    'reconciliation_required',NULL,NULL,'provider_document_rejected',
    true,'000','Error','another request')`, 'payper_outcome_fence');
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false);`);
  await fail('SELECT * FROM public.payper_provider_response_diagnostics', 'permission denied');
  await fail(`SELECT public.record_payper_dispatch_outcome_v2('${second}',
    'reconciliation_required',NULL,NULL,'provider_document_rejected',
    true,'000','Error','unauthorized')`, 'permission denied');
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.role','service_role',false);`);
  stage = 'new immutable future activation epoch';
  const oldCutoff = (await scalar('SELECT activation_cutoff_utc AS value FROM public.payper_dispatch_control')).value;
  const oldPending = await makePos('92000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000008');
  await db.query(`SELECT public.freeze_payper_source('${oldPending}')`);
  const oldBlocked = await makePos('92000000-0000-4000-8000-000000000011',
    '92000000-0000-4000-8000-000000000012');
  await db.query(`SELECT public.hold_payper_source('${oldBlocked}','provider_credentials_rejected')`);
  await db.query('SELECT pg_sleep(0.01)');
  const newCutoff = (await scalar(`SELECT public.activate_payper_future_canary('${actor}') AS value`)).value;
  assert.ok(new Date(newCutoff) > new Date(oldCutoff));
  assert.equal((await scalar('SELECT activation_cutoff_utc AS value FROM public.payper_dispatch_control')).value.toISOString(), oldCutoff.toISOString());
  assert.deepEqual(await scalar(`SELECT enabled,dispatch_mode,dispatch_remaining,canary_payment_id
    FROM public.payper_dispatch_control`), {
    enabled: true, dispatch_mode: 'canary', dispatch_remaining: 1, canary_payment_id: null,
  });
  await fail(`SELECT public.activate_payper_future_canary('${actor}')`, 'payper_future_activation_already_recorded');
  await fail(`SELECT public.target_payper_canary('${actor}','${oldPending}')`, 'payper_canary_payment_invalid');
  const future = (await scalar(`SELECT public.reserve_pos_pelecard('${actor}',
    '92000000-0000-4000-8000-000000000009',
    '[{"kind":"product","id":"92000000-0000-4000-8000-000000000002","qty":1}]',
    NULL,'{"kind":"person","name":"Synthetic Customer","identity":"000000018","email":"synthetic@example.test"}')
    AS value`)).value.paymentId;
  await db.query(`SELECT public.target_payper_canary('${actor}','${future}')`);
  await db.query(`SELECT public.claim_pos_pelecard_init('${future}')`);
  await db.query(`SELECT public.persist_pos_pelecard_session('${future}',
    '92000000-0000-4000-8000-000000000010','synthetic-key',
    'https://gateway20.pelecard.biz/PaymentGW?transactionId=92000000-0000-4000-8000-000000000010')`);
  await db.query(`SELECT public.observe_pos_pelecard('${future}','usable','000','000',true)`);
  await db.query(`SELECT public.finalize_pos_pelecard('${future}','synthetic-approval')`);
  const futureBlocked = await makePos('92000000-0000-4000-8000-000000000013',
    '92000000-0000-4000-8000-000000000014');
  await db.query(`SELECT public.hold_payper_source('${futureBlocked}','payper_billing_incomplete')`);
  assert.deepEqual((await db.query('SELECT public.list_payper_dispatch_candidates() AS id')).rows,
    [{ id: future }]);
  await db.query(`SELECT public.freeze_payper_source('${future}')`);
  await fail(`SELECT public.reserve_payper_dispatch('${oldPending}','100003')`, 'payper_dispatch_limit_reached');
  await db.query(`SELECT public.reserve_payper_dispatch('${future}','100004')`);
  assert.deepEqual((await db.query('SELECT public.list_payper_dispatch_candidates() AS id')).rows, []);
  await db.query(`SELECT public.record_payper_dispatch_outcome('${future}','succeeded','900002',
    'https://app.payper.co.il/public/invoice_show/900002?ak=synthetic',NULL)`);
  await db.query(`SELECT public.stop_payper_dispatch('${actor}')`);
  const firstFutureCutoff = (await scalar('SELECT public.payper_effective_cutoff() AS value')).value;
  await db.query('SELECT pg_sleep(0.01)');
  await db.query(`SELECT public.enable_payper_continuous('${actor}')`);
  assert.ok((await scalar('SELECT public.payper_effective_cutoff() AS value')).value > firstFutureCutoff);
  assert.deepEqual((await db.query('SELECT public.list_payper_dispatch_candidates() AS id')).rows, []);
  const later = await makePos('92000000-0000-4000-8000-000000000015',
    '92000000-0000-4000-8000-000000000016');
  assert.deepEqual((await db.query('SELECT public.list_payper_dispatch_candidates() AS id')).rows,
    [{ id: later }]);
  await db.query(`SELECT public.freeze_payper_source('${later}')`);
  await db.query(`SELECT public.reserve_payper_dispatch('${later}','100005')`);
  assert.equal((await scalar(`SELECT state FROM public.payper_document_ledger WHERE payment_id='${oldBlocked}'`)).state,
    'source_blocked');
  assert.equal((await scalar(`SELECT state FROM public.payper_document_ledger WHERE payment_id='${futureBlocked}'`)).state,
    'source_blocked');
  await fail(`SELECT public.reserve_payper_dispatch('${oldPending}','100003')`, 'payper_activation_fence');
  await fail(`UPDATE public.payper_dispatch_control SET future_cutoff_utc=now()-interval '1 day'`,
    'payper_future_cutoff_immutable');
  stage = 'repeatable future-only Payper canary epoch';
  await db.query(`SELECT public.stop_payper_dispatch('${actor}')`);
  await fail(`SELECT public.prepare_payper_next_canary('${actor}')`, 'payper_next_canary_not_ready');
  await db.query(`SELECT public.record_payper_dispatch_outcome('${later}',
    'reconciliation_required',NULL,NULL,'synthetic_uncertain_outcome')`);
  const preservedCutoff = (await scalar('SELECT future_cutoff_utc AS value FROM public.payper_dispatch_control')).value;
  await db.query("SELECT set_config('request.jwt.claim.role','authenticated',false)");
  await fail(`SELECT public.prepare_payper_next_canary('${actor}')`, 'administrator_required');
  await db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
  const renewedCutoff = (await scalar(`SELECT public.prepare_payper_next_canary('${actor}') AS value`)).value;
  assert.ok(new Date(renewedCutoff) > new Date(preservedCutoff));
  assert.equal((await scalar('SELECT future_cutoff_utc AS value FROM public.payper_dispatch_control')).value.toISOString(),
    preservedCutoff.toISOString());
  assert.equal(Number((await scalar('SELECT count(*) AS count FROM public.payper_activation_epoch_audit')).count), 4);
  assert.equal((await scalar('SELECT public.payper_effective_cutoff() AS value')).value.toISOString(),
    renewedCutoff.toISOString());
  await fail(`SELECT public.target_payper_canary('${actor}','${later}')`, 'payper_canary_payment_invalid');
  assert.deepEqual((await db.query('SELECT public.list_payper_dispatch_candidates() AS id')).rows, []);
  await fail(`SELECT public.prepare_payper_next_canary('${actor}')`, 'payper_next_canary_not_ready');
  const renewed = (await scalar(`SELECT public.reserve_pos_pelecard('${actor}',
    '92000000-0000-4000-8000-000000000017',
    '[{"kind":"product","id":"92000000-0000-4000-8000-000000000002","qty":1}]',
    NULL,'{"kind":"person","name":"Synthetic Customer","identity":"000000018","email":"synthetic@example.test"}')
    AS value`)).value.paymentId;
  await db.query(`SELECT public.target_payper_canary('${actor}','${renewed}')`);
  await db.query(`SELECT public.claim_pos_pelecard_init('${renewed}')`);
  await db.query(`SELECT public.persist_pos_pelecard_session('${renewed}',
    '92000000-0000-4000-8000-000000000018','synthetic-key',
    'https://gateway20.pelecard.biz/PaymentGW?transactionId=92000000-0000-4000-8000-000000000018')`);
  await db.query(`SELECT public.observe_pos_pelecard('${renewed}','usable','000','000',true)`);
  await db.query(`SELECT public.finalize_pos_pelecard('${renewed}','synthetic-approval')`);
  assert.deepEqual((await db.query('SELECT public.list_payper_dispatch_candidates() AS id')).rows,
    [{ id: renewed }]);
  await db.query(`SELECT public.freeze_payper_source('${renewed}')`);
  await db.query(`SELECT public.reserve_payper_dispatch('${renewed}','100006')`);
  await db.query(`SELECT public.record_payper_dispatch_outcome('${renewed}',
    'succeeded','900003','https://app.payper.co.il/public/invoice_show/900003?ak=synthetic',NULL)`);
  await db.query(`SELECT public.stop_payper_dispatch('${actor}')`);
  const finalCanaryCutoff = (await scalar('SELECT public.payper_effective_cutoff() AS value')).value;
  await db.query('SELECT pg_sleep(0.01)');
  await db.query(`SELECT public.enable_payper_continuous('${actor}')`);
  assert.equal((await scalar('SELECT dispatch_mode AS value FROM public.payper_dispatch_control')).value,
    'continuous');
  assert.ok((await scalar('SELECT public.payper_effective_cutoff() AS value')).value > finalCanaryCutoff);
  console.log('PASS automatic controls and synthetic POS payments: targeted canary, continuous dispatch, duplicate fence, emergency stop');
} catch (error) {
  console.error(`FAIL ${stage}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
