-- Disposable local database only, after the 202611150001 migration.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(14);

-- The disposable database contains only the columns read by the intake RPC.
CREATE TABLE public.payment_transactions (
  id uuid PRIMARY KEY, status text, amount numeric, currency text
);
CREATE TABLE public.payper_document_ledger (
  id uuid PRIMARY KEY, payment_id uuid, sale_id uuid, state text,
  document_number text, document_url text
);
INSERT INTO public.payment_transactions VALUES
  ('71500000-0000-4000-8000-000000000020','succeeded',4.00,'ILS'),
  ('71500000-0000-4000-8000-000000000021','succeeded',4.00,'ILS');
INSERT INTO public.payper_document_ledger VALUES
  ('71500000-0000-4000-8000-000000000022',
   '71500000-0000-4000-8000-000000000020',NULL,'succeeded','200002','https://app.payper.co.il/test'),
  ('71500000-0000-4000-8000-000000000023',
   '71500000-0000-4000-8000-000000000021',NULL,'source_frozen',NULL,NULL);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(public.capture_succeeded_payper_bookkeeping_intake(
  '71500000-0000-4000-8000-000000000020'), NULL::uuid,
  'intake is disabled by default');
RESET ROLE;
UPDATE public.rivhit_bookkeeping_intake_control SET enabled = true WHERE singleton;
SET LOCAL ROLE service_role;
SELECT extensions.ok(public.capture_succeeded_payper_bookkeeping_intake(
  '71500000-0000-4000-8000-000000000020') IS NOT NULL,
  'only a successful Payper ledger is captured');
SELECT extensions.is(public.capture_succeeded_payper_bookkeeping_intake(
  '71500000-0000-4000-8000-000000000020'),
  (SELECT id FROM public.rivhit_bookkeeping_intake
   WHERE payment_id='71500000-0000-4000-8000-000000000020'),
  'repeat capture returns the same intake identity');
SELECT extensions.is((SELECT count(*)::integer FROM public.rivhit_bookkeeping_intake), 1,
  'duplicate capture creates one held row');
SELECT extensions.is(public.capture_succeeded_payper_bookkeeping_intake(
  '71500000-0000-4000-8000-000000000021'), NULL::uuid,
  'a non-successful Payper ledger cannot enter intake');

INSERT INTO public.rivhit_bookkeeping_sources (
  id, account_namespace, source_system, source_document_id, document_number,
  document_type, payment_id, issued_at, gross_minor, currency, source_snapshot, source_hash)
VALUES (
  '71500000-0000-4000-8000-000000000001', 'test-account', 'payper',
  'payper-200002', '200002', 'invoice_receipt',
  '71500000-0000-4000-8000-000000000002', now(), 400, 'ILS',
  '{"test":true}', repeat('a', 64));

SELECT extensions.throws_ok($$
  INSERT INTO public.rivhit_bookkeeping_sources (
    account_namespace, source_system, source_document_id, document_number,
    document_type, payment_id, issued_at, gross_minor, currency, source_snapshot, source_hash)
  VALUES ('test-account', 'payper', 'payper-200002', '200002', 'invoice_receipt',
    '71500000-0000-4000-8000-000000000002', now(), 400, 'ILS', '{}', repeat('b', 64))
$$, '23505', NULL, 'same source document cannot be inserted twice');

INSERT INTO public.rivhit_bookkeeping_legs (
  id, source_id, leg_kind, request_reference)
VALUES ('71500000-0000-4000-8000-000000000003',
  '71500000-0000-4000-8000-000000000001', 'invoice', 'test:200002:invoice');

SELECT extensions.is((SELECT status FROM public.rivhit_bookkeeping_legs
  WHERE id = '71500000-0000-4000-8000-000000000003'),
  'held_mapping', 'new leg is held by default');
SELECT extensions.is((SELECT count(*)::integer FROM public.claim_rivhit_bookkeeping_leg(
  '71500000-0000-4000-8000-000000000003', 'v1', 'accountant', 'test-account')),
  0, 'unmapped leg cannot be claimed');

UPDATE public.rivhit_bookkeeping_legs SET status = 'ready', mapping_version = 'v1',
  mapping_approval_ref = 'accountant', frozen_request = '{"amount":4}',
  request_hash = repeat('c', 64)
WHERE id = '71500000-0000-4000-8000-000000000003';

SELECT extensions.is((SELECT count(*)::integer FROM public.claim_rivhit_bookkeeping_leg(
  '71500000-0000-4000-8000-000000000003', 'wrong', 'accountant', 'test-account')),
  0, 'different mapping revision cannot claim');
SELECT extensions.is((SELECT count(*)::integer FROM public.claim_rivhit_bookkeeping_leg(
  '71500000-0000-4000-8000-000000000003', 'v1', 'accountant', 'test-account')),
  1, 'approved mapping claims once');
SELECT extensions.is((SELECT count(*)::integer FROM public.claim_rivhit_bookkeeping_leg(
  '71500000-0000-4000-8000-000000000003', 'v1', 'accountant', 'test-account')),
  0, 'dispatched leg cannot be claimed again');

SELECT extensions.throws_ok($$
  UPDATE public.rivhit_bookkeeping_legs SET dispatch_started_at = NULL, status = 'ready'
  WHERE id = '71500000-0000-4000-8000-000000000003'
$$, 'P0001', 'bookkeeping_dispatch_cannot_be_reset', 'dispatch marker is immutable');

SELECT extensions.ok(public.hold_rivhit_bookkeeping_leg(
  '71500000-0000-4000-8000-000000000003',
  (SELECT claim_token FROM public.rivhit_bookkeeping_legs
    WHERE id = '71500000-0000-4000-8000-000000000003'), 'unknown_outcome'),
  'unknown result is held for reconciliation');
SELECT extensions.is((SELECT count(*)::integer FROM public.claim_rivhit_bookkeeping_leg(
  '71500000-0000-4000-8000-000000000003', 'v1', 'accountant', 'test-account')),
  0, 'held result cannot be retried');

SELECT extensions.finish();
ROLLBACK;
