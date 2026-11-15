-- Disposable local database only, after the 202611150001 migration.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

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
