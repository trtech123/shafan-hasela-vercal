-- Run only against disposable local/staging Supabase:
-- npx supabase test db supabase/tests/payment_accounting_orchestration.sql --local

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

INSERT INTO auth.users (id, email) VALUES
  ('70000000-0000-4000-8000-000000000001', 'accounting-ops@example.test');

SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"70000000-0000-4000-8000-000000000001"}',
  true
);

UPDATE public.profiles
SET role = 'operations'
WHERE id = '70000000-0000-4000-8000-000000000001';

RESET ROLE;

INSERT INTO public.orders (
  id, client_name, client_phone, activity_date, num_participants
) VALUES (
  '70000000-0000-4000-8000-000000000002',
  'Accounting Test',
  '0500000000',
  CURRENT_DATE,
  1
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.claim_accounting_event(uuid,text,integer,boolean)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.claim_accounting_event(uuid,text,integer,boolean)',
    'EXECUTE'
  ),
  'event mutation RPC is service-role only'
);

SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"70000000-0000-4000-8000-000000000001"}',
  true
);

SELECT public.reserve_pelecard_payment(
  '70000000-0000-4000-8000-000000000010',
  '70000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001',
  'accounting-payment-1',
  120.00,
  'ILS',
  jsonb_build_object(
    'schema_version', 1,
    'items', jsonb_build_array(jsonb_build_object(
      'id', 'activity-1', 'name', 'Accounting item',
      'qty', 1, 'customPrice', 120
    )),
    'discount', NULL,
    'linked_order_info', jsonb_build_object(
      'order_number', 'ORD-ACCOUNTING',
      'client_name', 'Accounting Test',
      'client_phone', '0500000000',
      'organization', ''
    ),
    'sale_date', CURRENT_DATE::TEXT
  )
);

SELECT public.complete_pelecard_initiation(
  '70000000-0000-4000-8000-000000000010',
  'session-accounting-1',
  'https://sandbox.example.test/hosted/session-accounting-1'
);

SELECT public.finalize_pelecard_payment(
  '70000000-0000-4000-8000-000000000010',
  'provider-accounting-1',
  'approval-accounting-1',
  '000',
  120.00,
  'ILS'
);

SELECT extensions.is(
  (SELECT count(*)::INTEGER
   FROM public.accounting_events
   WHERE source_type = 'payment_transaction'
     AND source_id = '70000000-0000-4000-8000-000000000010'
     AND purpose = 'payment_success'
     AND accounting_provider = 'rivhit'),
  1,
  'verified success creates one accounting event'
);

SELECT public.finalize_pelecard_payment(
  '70000000-0000-4000-8000-000000000010',
  'provider-accounting-1',
  'approval-accounting-1',
  '000',
  120.00,
  'ILS'
);

SELECT extensions.is(
  (SELECT count(*)::INTEGER
   FROM public.accounting_events
   WHERE source_id = '70000000-0000-4000-8000-000000000010'),
  1,
  'duplicate finalization does not duplicate the accounting event'
);

SELECT extensions.ok(
  (SELECT status = 'succeeded'
          AND verified_at IS NOT NULL
          AND provider_transaction_id = 'provider-accounting-1'
          AND sale_id IS NOT NULL
   FROM public.payment_transactions
   WHERE id = '70000000-0000-4000-8000-000000000010'),
  'event is sourced from durable locally verified payment fields'
);

CREATE TEMP TABLE first_claim AS
SELECT *
FROM public.claim_accounting_event(
  (SELECT id FROM public.accounting_events
   WHERE source_id = '70000000-0000-4000-8000-000000000010'),
  'worker-one',
  300,
  FALSE
);

SELECT extensions.ok(
  (SELECT claimed AND status = 'processing' AND attempt_count = 1
          AND lease_token IS NOT NULL AND lease_expires_at > NOW()
   FROM first_claim),
  'first worker receives an explicit live lease'
);

SELECT extensions.ok(
  NOT (SELECT claimed
       FROM public.claim_accounting_event(
         (SELECT id FROM first_claim), 'worker-two', 300, FALSE
       )),
  'second claim cannot steal a live lease'
);

RESET ROLE;
UPDATE public.accounting_events
SET lease_expires_at = NOW() - INTERVAL '1 second'
WHERE id = (SELECT id FROM first_claim);

SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"70000000-0000-4000-8000-000000000001"}',
  true
);

CREATE TEMP TABLE second_claim AS
SELECT *
FROM public.claim_accounting_event(
  (SELECT id FROM first_claim),
  'worker-two',
  300,
  FALSE
);

SELECT extensions.ok(
  (SELECT claimed AND attempt_count = 2
          AND lease_token IS DISTINCT FROM (SELECT lease_token FROM first_claim)
   FROM second_claim),
  'expired lease can be reclaimed'
);

SELECT extensions.ok(
  NOT public.complete_accounting_event(
    (SELECT id FROM first_claim),
    (SELECT attempt_count FROM first_claim),
    (SELECT lease_token FROM first_claim)
  ),
  'stale attempt cannot complete newer work'
);

SELECT extensions.ok(
  NOT public.fail_accounting_event(
    (SELECT id FROM second_claim),
    (SELECT attempt_count FROM second_claim),
    '70000000-0000-4000-8000-000000000099',
    'permanent_error',
    NULL,
    jsonb_build_object('message', 'wrong token')
  ),
  'wrong lease token cannot fail work'
);

SELECT extensions.ok(
  public.fail_accounting_event(
    (SELECT id FROM second_claim),
    (SELECT attempt_count FROM second_claim),
    (SELECT lease_token FROM second_claim),
    'permanent_error',
    NOW() + INTERVAL '1 hour',
    jsonb_build_object('message', 'sanitized provider failure', 'errorCode', 'E_TEST')
  ),
  'current fenced attempt can record a terminal failure'
);

SELECT extensions.ok(
  (SELECT status = 'succeeded'
   FROM public.payment_transactions
   WHERE id = '70000000-0000-4000-8000-000000000010')
  AND
  (SELECT status = 'permanent_error' AND next_attempt_at IS NULL
   FROM public.accounting_events
   WHERE id = (SELECT id FROM second_claim)),
  'event failure does not reverse payment success'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"70000000-0000-4000-8000-000000000001"}',
  true
);

SELECT extensions.ok(
  (SELECT count(*) = 1
   FROM public.payment_accounting_operations
   WHERE payment_transaction_id = '70000000-0000-4000-8000-000000000010'
     AND accounting_status = 'permanent_error'
     AND NOT reconciliation_required
     AND NOT retry_allowed),
  'operations can read payment and accounting status without mutation access'
);

RESET ROLE;
SELECT extensions.is(
  (SELECT count(*)::INTEGER
   FROM public.accounting_events
   WHERE source_type <> 'payment_transaction'),
  0,
  'migration creates no historical or non-Pelecard accounting events'
);

SELECT * FROM extensions.finish();
ROLLBACK;
