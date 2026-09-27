-- Disposable local PostgreSQL only. Never execute this fixture in production.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(12);
SELECT extensions.ok(NOT has_table_privilege('authenticated','public.pelecard_test_payments','SELECT'), 'no browser access to private TEST evidence');
SELECT extensions.ok(NOT has_table_privilege('authenticated','public.pelecard_test_payments','INSERT'), 'no browser TEST writes');
SELECT extensions.ok(NOT has_table_privilege('anon','public.pelecard_test_payments','SELECT'), 'no anonymous TEST reads');
SELECT extensions.ok(has_table_privilege('service_role','public.pelecard_test_payments','UPDATE'), 'service role can persist TEST evidence');
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pelecard_test_payments' AND column_name IN ('order_id','sale_id','terminal','password','user')), 'TEST table has no commercial links or credentials');

INSERT INTO auth.users(id,email) VALUES ('71000000-0000-4000-8000-000000000001','isolated-test@example.test');
CREATE TEMP TABLE commercial_before AS SELECT
  (SELECT count(*) FROM public.orders) AS orders,
  (SELECT count(*) FROM public.sales) AS sales,
  (SELECT count(*) FROM public.payment_transactions) AS payments,
  (SELECT count(*) FROM public.accounting_events) AS events,
  (SELECT count(*) FROM public.accounting_documents) AS documents;

INSERT INTO public.pelecard_test_payments(id,created_by) VALUES ('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001');
SELECT extensions.is((SELECT mode FROM public.pelecard_test_payments LIMIT 1),'test','mode is explicitly TEST');
SELECT extensions.throws_ok($$UPDATE public.pelecard_test_payments SET mode='live'$$, '23514', 'test_identity_immutable', 'cannot promote TEST record to LIVE');
SELECT extensions.throws_ok($$UPDATE public.pelecard_test_payments SET amount_minor=200$$, '23514', 'test_identity_immutable', 'cannot change reserved amount');
SELECT extensions.throws_ok($$UPDATE public.pelecard_test_payments SET status='test_verified'$$, '23514', 'invalid_test_transition', 'cannot verify without initialized session');
UPDATE public.pelecard_test_payments SET status='pending',confirmation_key='synthetic-test-key',redirect_url='https://gateway20.pelecard.biz/PaymentGW/synthetic';
UPDATE public.pelecard_test_payments SET status='test_verified',provider_transaction_id='1a111c-1d1f6g-9h8j',api_status='000',transaction_status='000',verified_at=now();
SELECT extensions.is((SELECT status FROM public.pelecard_test_payments LIMIT 1),'test_verified','verified TEST is distinctly named');
SELECT extensions.throws_ok($$UPDATE public.pelecard_test_payments SET status='pending'$$, '23514', 'invalid_test_transition', 'verified TEST cannot regress');
SELECT extensions.ok((SELECT orders=(SELECT count(*) FROM public.orders) AND sales=(SELECT count(*) FROM public.sales) AND payments=(SELECT count(*) FROM public.payment_transactions) AND events=(SELECT count(*) FROM public.accounting_events) AND documents=(SELECT count(*) FROM public.accounting_documents) FROM commercial_before), 'TEST success creates no commercial payment, sale, order or accounting effect');
SELECT * FROM extensions.finish();
ROLLBACK;
