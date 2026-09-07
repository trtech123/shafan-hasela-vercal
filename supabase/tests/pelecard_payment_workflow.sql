-- Run only against disposable local/staging Supabase:
-- npx supabase test db supabase/tests/pelecard_payment_workflow.sql --local

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

INSERT INTO auth.users (id, email) VALUES
  ('40000000-0000-4000-8000-000000000001', 'payment-workflow@example.test');

INSERT INTO public.orders (
  id, client_name, client_phone, activity_date, num_participants
) VALUES (
  '40000000-0000-4000-8000-000000000002',
  'Payment Test',
  '0500000000',
  CURRENT_DATE,
  1
);

INSERT INTO public.sales (
  id, items, total, method, created_by
) VALUES (
  '40000000-0000-4000-8000-000000000003',
  '[]'::JSONB,
  10.00,
  'אשראי',
  '40000000-0000-4000-8000-000000000001'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.finalize_pelecard_payment(uuid,text,text,text,numeric,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.finalize_pelecard_payment(uuid,text,text,text,numeric,text)',
    'EXECUTE'
  ),
  'finalization execute privilege is service-role only'
);

SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"40000000-0000-4000-8000-000000000001"}',
  true
);

SELECT extensions.ok(
  (public.reserve_pelecard_payment(
    '40000000-0000-4000-8000-000000000010',
    '40000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    'workflow-payment-1',
    120.00,
    'ILS',
    jsonb_build_object(
      'schema_version', 1,
      'items', jsonb_build_array(jsonb_build_object(
        'id', 'activity-1', 'name', 'Workflow item',
        'qty', 1, 'customPrice', 120
      )),
      'discount', NULL,
      'linked_order_info', jsonb_build_object(
        'order_number', 'ORD-TEST',
        'client_name', 'Payment Test',
        'client_phone', '0500000000',
        'organization', ''
      ),
      'sale_date', CURRENT_DATE::TEXT
    )
  ) ->> 'created')::BOOLEAN,
  'first reservation owns provider initiation'
);

SELECT extensions.ok(
  NOT (public.reserve_pelecard_payment(
    '40000000-0000-4000-8000-000000000099',
    '40000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    'workflow-payment-1',
    120.00,
    'ILS',
    jsonb_build_object(
      'schema_version', 1,
      'items', jsonb_build_array(jsonb_build_object(
        'id', 'activity-1', 'name', 'Workflow item',
        'qty', 1, 'customPrice', 120
      )),
      'discount', NULL,
      'linked_order_info', jsonb_build_object(
        'order_number', 'ORD-TEST',
        'client_name', 'Payment Test',
        'client_phone', '0500000000',
        'organization', ''
      ),
      'sale_date', CURRENT_DATE::TEXT
    )
  ) ->> 'created')::BOOLEAN,
  'duplicate reservation returns the existing attempt'
);

SELECT public.complete_pelecard_initiation(
  '40000000-0000-4000-8000-000000000010',
  'session-workflow-1',
  'https://sandbox.example.test/hosted/session-workflow-1'
);

SELECT extensions.is(
  public.get_pelecard_payment(
    '40000000-0000-4000-8000-000000000010'
  ) ->> 'status',
  'pending_provider',
  'hosted initiation becomes pending without exposing provider work'
);

CREATE TEMP TABLE first_finalization AS
SELECT public.finalize_pelecard_payment(
  '40000000-0000-4000-8000-000000000010',
  'provider-workflow-1',
  'approval-workflow-1',
  '000',
  120.00,
  'ILS'
) AS result;

SELECT extensions.ok(
  (SELECT count(*) = 1 FROM public.sales
   WHERE payment_transaction_id = '40000000-0000-4000-8000-000000000010')
  AND (SELECT status = 'succeeded' AND sale_id IS NOT NULL
       FROM public.payment_transactions
       WHERE id = '40000000-0000-4000-8000-000000000010')
  AND (SELECT payment_status = 'פלאקארד' FROM public.orders
       WHERE id = '40000000-0000-4000-8000-000000000002'),
  'one sale is created and payment sale order state is atomic'
);

CREATE TEMP TABLE duplicate_finalization AS
SELECT public.finalize_pelecard_payment(
  '40000000-0000-4000-8000-000000000010',
  'provider-workflow-1',
  'approval-workflow-1',
  '000',
  120.00,
  'ILS'
) AS result;

SELECT extensions.is(
  (SELECT result ->> 'sale_id' FROM duplicate_finalization),
  (SELECT result ->> 'sale_id' FROM first_finalization),
  'duplicate finalization returns the same sale'
);

SELECT extensions.is(
  public.finalize_pelecard_payment(
    '40000000-0000-4000-8000-000000000010',
    'provider-workflow-1',
    'approval-workflow-1',
    '000',
    120.00,
    'ILS'
  ) ->> 'sale_id',
  (SELECT result ->> 'sale_id' FROM first_finalization),
  'finalization retry after committed response loss is idempotent'
);

SELECT public.reserve_pelecard_payment(
  '40000000-0000-4000-8000-000000000020',
  NULL,
  '40000000-0000-4000-8000-000000000001',
  'workflow-payment-2',
  50.00,
  'ILS',
  jsonb_build_object(
    'schema_version', 1,
    'items', jsonb_build_array(jsonb_build_object(
      'id', 'activity-2', 'name', 'Second item',
      'qty', 1, 'customPrice', 50
    )),
    'discount', NULL,
    'linked_order_info', NULL,
    'sale_date', CURRENT_DATE::TEXT
  )
);

SELECT extensions.throws_ok(
  $$SELECT public.finalize_pelecard_payment(
    '40000000-0000-4000-8000-000000000020', 'provider-workflow-2',
    'approval-workflow-2', '000', 50.01, 'ILS')$$,
  '23514', NULL, 'amount mismatch cannot finalize'
);

SELECT extensions.throws_ok(
  $$SELECT public.finalize_pelecard_payment(
    '40000000-0000-4000-8000-000000000020', 'provider-workflow-2',
    'approval-workflow-2', '000', 50.00, 'USD')$$,
  '23514', NULL, 'currency mismatch cannot finalize'
);

SELECT extensions.throws_ok(
  $$SELECT public.finalize_pelecard_payment(
    '40000000-0000-4000-8000-000000000020', 'provider-workflow-1',
    'approval-workflow-2', '000', 50.00, 'ILS')$$,
  '23505', NULL, 'provider transaction cannot be assigned twice'
);

SELECT extensions.is(
  (SELECT count(*)::INTEGER FROM public.payment_transaction_events
   WHERE payment_transaction_id = '40000000-0000-4000-8000-000000000010'
     AND status = 'succeeded'),
  1,
  'successful status transition is recorded exactly once'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"40000000-0000-4000-8000-000000000001"}',
  true
);

SELECT extensions.throws_ok(
  $$SELECT public.finalize_pelecard_payment(
    '40000000-0000-4000-8000-000000000010', 'provider-workflow-1',
    'approval-workflow-1', '000', 120.00, 'ILS')$$,
  '42501', NULL, 'authenticated cannot execute finalization'
);

RESET ROLE;
SELECT extensions.is(
  (SELECT method FROM public.sales
   WHERE id = '40000000-0000-4000-8000-000000000003'),
  'אשראי',
  'manual credit sale remains unchanged'
);

SELECT * FROM extensions.finish();
ROLLBACK;
