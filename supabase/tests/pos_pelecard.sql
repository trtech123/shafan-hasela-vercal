-- Disposable local database only. Apply all migrations first; rollback fixtures.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(37);
SELECT extensions.ok(NOT has_table_privilege('authenticated','public.pos_pelecard_intents','SELECT,INSERT,UPDATE,DELETE'),'POS intent private');
SELECT extensions.ok(NOT has_function_privilege('authenticated','public.reserve_pos_pelecard(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE'),'browser cannot reserve');
SELECT extensions.ok(NOT has_function_privilege('service_role','public.claim_pos_pelecard_init(uuid)','EXECUTE'),'Edge cannot bypass Node claim');
SELECT extensions.ok(NOT has_function_privilege('pelecard_controlled_live_adapter','public.finalize_pos_pelecard(uuid,text)','EXECUTE'),'Node cannot finalize sale');
INSERT INTO auth.users(id,email) VALUES('91000000-0000-4000-8000-000000000001','pos-admin@example.test');
SELECT set_config('request.jwt.claim.role','service_role',true);
UPDATE public.profiles SET role='admin' WHERE id='91000000-0000-4000-8000-000000000001';
INSERT INTO public.products(id,name,price,status) VALUES('91000000-0000-4000-8000-000000000002','Synthetic water',1,'פעיל');
INSERT INTO public.activities(id,name,price_per_person,status) VALUES('91000000-0000-4000-8000-000000000003','Synthetic climb',12.50,'פעיל');
SELECT extensions.throws_ok($$SELECT public.reserve_pos_pelecard('91000000-0000-4000-8000-000000000099',
  '91000000-0000-4000-8000-000000000004','[{"kind":"product","id":"91000000-0000-4000-8000-000000000002","qty":1}]',NULL,'{}')$$,
  '42501','pos_payment_forbidden','unknown actor denied');
SELECT extensions.throws_ok($$SELECT public.reserve_pos_pelecard('91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000004','[{"kind":"product","id":"91000000-0000-4000-8000-000000000002","qty":1,"price":0.01}]',NULL,'{}')$$,
  '23514','cart_line_invalid','browser amount rejected');
SELECT set_config('test.pos_payment',(public.reserve_pos_pelecard('91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000004',
  '[{"kind":"product","id":"91000000-0000-4000-8000-000000000002","qty":1},{"kind":"service","id":"91000000-0000-4000-8000-000000000003","qty":2}]',
  NULL,'{"kind":"person","name":"Synthetic Customer","identity":"000000018","email":"synthetic@example.test"}')
  ->>'paymentId'),true);
SELECT extensions.is((SELECT amount FROM public.payment_transactions WHERE id=current_setting('test.pos_payment')::uuid),26.00::numeric,'catalog amount frozen');
SELECT extensions.is((SELECT vat_applicable FROM public.pos_pelecard_intents WHERE payment_id=current_setting('test.pos_payment')::uuid),true,'regular VAT frozen');
SELECT extensions.is((SELECT billing_identity FROM public.payper_payment_billing_snapshots WHERE payment_id=current_setting('test.pos_payment')::uuid),
  '000000018','private billing identity frozen');
SELECT extensions.is((SELECT checkout_snapshot->'items'->1->>'name' FROM public.payment_transactions WHERE id=current_setting('test.pos_payment')::uuid),
  'Synthetic climb','service description frozen');
SELECT extensions.is((SELECT count(*) FROM public.sales WHERE payment_transaction_id=current_setting('test.pos_payment')::uuid),0::bigint,'no sale before provider verification');
SELECT extensions.is((SELECT amount_minor FROM public.claim_pos_pelecard_init(current_setting('test.pos_payment')::uuid)),2600,'Node claims stored amount');
SELECT extensions.is((SELECT count(*) FROM public.claim_pos_pelecard_init(current_setting('test.pos_payment')::uuid)),0::bigint,'Node cannot claim twice');
SELECT extensions.lives_ok($$SELECT public.persist_pos_pelecard_session(current_setting('test.pos_payment')::uuid,
  '91000000-0000-4000-8000-000000000005','synthetic-key',
  'https://gateway20.pelecard.biz/PaymentGW?transactionId=91000000-0000-4000-8000-000000000005')$$,'session persisted');
SELECT extensions.throws_ok($$SELECT public.finalize_pos_pelecard(current_setting('test.pos_payment')::uuid,'approval')$$,
  '23514','pos_verification_required','cannot finalize without verified evidence');
SELECT public.observe_pos_pelecard(current_setting('test.pos_payment')::uuid,'usable','510',NULL,true);
SELECT extensions.throws_ok($$SELECT public.finalize_pos_pelecard(current_setting('test.pos_payment')::uuid,'approval')$$,
  '23514','pos_verification_required','decline/unknown never finalizes');
SELECT public.observe_pos_pelecard(current_setting('test.pos_payment')::uuid,'usable','000','000',true);
SELECT extensions.lives_ok($$SELECT public.finalize_pos_pelecard(current_setting('test.pos_payment')::uuid,'approval')$$,'verified payment finalizes');
SELECT extensions.lives_ok($$SELECT public.finalize_pos_pelecard(current_setting('test.pos_payment')::uuid,'approval')$$,'duplicate confirmation idempotent');
SELECT extensions.is((SELECT count(*) FROM public.sales WHERE payment_transaction_id=current_setting('test.pos_payment')::uuid),1::bigint,'one sale and daily report row');
SELECT extensions.is((SELECT method FROM public.sales WHERE payment_transaction_id=current_setting('test.pos_payment')::uuid),'פלאקארד','hosted payment distinct from manual card');
SELECT extensions.is((SELECT sale_date FROM public.sales WHERE payment_transaction_id=current_setting('test.pos_payment')::uuid),
  (clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date,'sale reported on local settlement date');
SELECT extensions.is((SELECT count(*) FROM public.payper_document_ledger WHERE payment_id=current_setting('test.pos_payment')::uuid),
  0::bigint,'complete pre-cutoff payment excluded from future Payper processing');
SELECT extensions.is((SELECT status FROM public.accounting_events WHERE source_type='payment_transaction'
  AND source_id=current_setting('test.pos_payment')),'configuration_required',
  'pre-cutoff POS payment cannot enter Rivhit issuance');
SELECT extensions.throws_ok($$UPDATE public.accounting_events SET status='processing'
  WHERE source_type='payment_transaction' AND source_id=current_setting('test.pos_payment')$$,
  '42501','pos_rivhit_issuance_held','POS Rivhit force-retry remains blocked');
INSERT INTO public.accounting_customers(id,provider,account_namespace,identity_key,external_reference)
  VALUES('91000000-0000-4000-8000-000000000015','rivhit','pos-test','synthetic-identity','synthetic-reference');
SELECT extensions.throws_ok($$INSERT INTO public.accounting_documents(provider,account_namespace,accounting_customer_id,
  source_type,source_id,document_type_key,external_document_type,status,request_reference,payload_hash)
  VALUES('rivhit','pos-test','91000000-0000-4000-8000-000000000015',
  'payment_transaction',current_setting('test.pos_payment'),'invoice_receipt',1,'processing','synthetic-request','synthetic-hash')$$,
  '42501','pos_rivhit_issuance_held','direct Rivhit document claim blocked for POS');
SELECT set_config('test.pos_discount',(public.reserve_pos_pelecard('91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000012',
  '[{"kind":"product","id":"91000000-0000-4000-8000-000000000002","qty":1}]',
  '{"type":"הנחה כללית","mode":"fixed","value":0.5}','{}')->>'paymentId'),true);
SELECT extensions.is((SELECT amount FROM public.payment_transactions WHERE id=current_setting('test.pos_discount')::uuid),
  0.50::numeric,'admin discount computed against catalog price');
SELECT extensions.is((SELECT (checkout_snapshot->'discount'->>'final_total')::numeric FROM public.payment_transactions
  WHERE id=current_setting('test.pos_discount')::uuid),0.50::numeric,'discount snapshot frozen');
SELECT extensions.ok(public.cancel_pos_pelecard_prepared('91000000-0000-4000-8000-000000000012',
  '91000000-0000-4000-8000-000000000001'),'prepared intent can be canceled without provider contact');
SELECT extensions.is((SELECT status FROM public.payment_transactions WHERE id=current_setting('test.pos_discount')::uuid),
  'failed','canceled prepared intent cannot be charged');
INSERT INTO auth.users(id,email) VALUES('91000000-0000-4000-8000-000000000013','pos-cashier@example.test');
UPDATE public.profiles SET role='cashier' WHERE id='91000000-0000-4000-8000-000000000013';
SELECT extensions.throws_ok($$SELECT public.reserve_pos_pelecard('91000000-0000-4000-8000-000000000013',
  '91000000-0000-4000-8000-000000000014',
  '[{"kind":"product","id":"91000000-0000-4000-8000-000000000002","qty":1}]',
  '{"type":"הנחה כללית","mode":"fixed","value":0.5}','{}')$$,
  '23514','discount_invalid','cashier cannot authorize a discount');
SELECT set_config('test.pos_missing',(public.reserve_pos_pelecard('91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000008',
  '[{"kind":"product","id":"91000000-0000-4000-8000-000000000002","qty":1}]',NULL,
  '{"kind":"person","name":"Synthetic Customer","identity":"000000000","email":"synthetic@example.test"}')
  ->>'paymentId'),true);
SELECT amount_minor FROM public.claim_pos_pelecard_init(current_setting('test.pos_missing')::uuid);
SELECT public.persist_pos_pelecard_session(current_setting('test.pos_missing')::uuid,
  '91000000-0000-4000-8000-000000000009','synthetic-key-3',
  'https://gateway20.pelecard.biz/PaymentGW?transactionId=91000000-0000-4000-8000-000000000009');
SELECT public.observe_pos_pelecard(current_setting('test.pos_missing')::uuid,'usable','000','000',true);
SELECT public.finalize_pos_pelecard(current_setting('test.pos_missing')::uuid,'approval-3');
SELECT extensions.is((SELECT billing_identity FROM public.payper_payment_billing_snapshots WHERE payment_id=current_setting('test.pos_missing')::uuid),
  NULL::text,'invented zero identity not frozen');
SELECT extensions.is((SELECT reconciliation_code FROM public.payper_document_ledger WHERE payment_id=current_setting('test.pos_missing')::uuid),
  'billing_identity_required','incomplete source creates manual obligation without invoice');
-- Prospective Payper capture stays disabled but records a complete sale source.
UPDATE public.payper_dispatch_control SET activation_cutoff_utc=statement_timestamp() WHERE singleton;
SELECT set_config('test.pos_payper',(public.reserve_pos_pelecard('91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000010',
  '[{"kind":"product","id":"91000000-0000-4000-8000-000000000002","qty":1}]',
  NULL,'{"kind":"organization","name":"Synthetic Ltd","identity":"512783333","email":"synthetic@example.test"}')
  ->>'paymentId'),true);
SELECT amount_minor FROM public.claim_pos_pelecard_init(current_setting('test.pos_payper')::uuid);
SELECT public.persist_pos_pelecard_session(current_setting('test.pos_payper')::uuid,
  '91000000-0000-4000-8000-000000000011','synthetic-key-2',
  'https://gateway20.pelecard.biz/PaymentGW?transactionId=91000000-0000-4000-8000-000000000011');
SELECT public.observe_pos_pelecard(current_setting('test.pos_payper')::uuid,'usable','000','000',true);
SELECT public.finalize_pos_pelecard(current_setting('test.pos_payper')::uuid,'approval-2');
SELECT extensions.is((SELECT state FROM public.payper_document_ledger WHERE payment_id=current_setting('test.pos_payper')::uuid),
  'eligible','sale source captured after cutoff');
SELECT extensions.is((SELECT order_id FROM public.payper_document_ledger WHERE payment_id=current_setting('test.pos_payper')::uuid),
  NULL::uuid,'standalone source has no fake order');
SELECT extensions.is(public.freeze_payper_source(current_setting('test.pos_payper')::uuid)->>'sourceType',
  'sale','Payper freezes sale-only source');
SELECT extensions.throws_ok($$SELECT public.reserve_payper_dispatch(current_setting('test.pos_payper')::uuid,'103059585')$$,
  '42501','payper_dispatch_disabled','Payper dispatch remains disabled');
SELECT extensions.is((SELECT count(*) FROM public.payper_document_ledger WHERE state='succeeded'),0::bigint,'no Payper document issued');
SELECT * FROM extensions.finish();
ROLLBACK;
