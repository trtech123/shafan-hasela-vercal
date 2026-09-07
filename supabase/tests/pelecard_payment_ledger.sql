-- Run with: npx supabase test db supabase/tests/pelecard_payment_ledger.sql --local
-- The Supabase pgTAP runner wraps this disposable test in a transaction.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(12);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.payment_transactions', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.payment_transactions', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.payment_transactions', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.payment_transactions', 'TRUNCATE')
  AND NOT has_table_privilege('anon', 'public.payment_transaction_events', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.payment_transaction_events', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.payment_transaction_events', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.payment_transaction_events', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.payment_transactions', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.payment_transactions', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.payment_transactions', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.payment_transactions', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.payment_transaction_events', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.payment_transaction_events', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.payment_transaction_events', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.payment_transaction_events', 'TRUNCATE')
  AND has_table_privilege('service_role', 'public.payment_transactions', 'SELECT')
  AND has_table_privilege('service_role', 'public.payment_transactions', 'INSERT')
  AND has_table_privilege('service_role', 'public.payment_transactions', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.payment_transactions', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.payment_transactions', 'TRUNCATE')
  AND has_table_privilege('service_role', 'public.payment_transaction_events', 'SELECT')
  AND has_table_privilege('service_role', 'public.payment_transaction_events', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.payment_transaction_events', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.payment_transaction_events', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.payment_transaction_events', 'TRUNCATE'),
  'ledger tables expose only the required role privileges'
);

CREATE OR REPLACE FUNCTION pg_temp.payment_ledger_behavior_is_valid()
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  payment_id UUID := uuid_generate_v4();
  refund_id UUID := uuid_generate_v4();
  event_count INTEGER;
BEGIN
  INSERT INTO public.payment_transactions (
    id,
    amount,
    currency,
    idempotency_key,
    checkout_snapshot
  ) VALUES (
    payment_id,
    120.00,
    'ILS',
    'ledger-test-payment-1',
    jsonb_build_object(
      'schema_version', 1,
      'items', jsonb_build_array(jsonb_build_object(
        'id', 'activity-1',
        'name', 'Ledger test item',
        'qty', 1,
        'customPrice', 120
      )),
      'discount', NULL,
      'linked_order_info', NULL,
      'sale_date', '2026-09-07'
    )
  );

  SELECT count(*)
  INTO event_count
  FROM public.payment_transaction_events
  WHERE payment_transaction_id = payment_id;

  IF event_count <> 1 THEN
    RETURN FALSE;
  END IF;

  BEGIN
    INSERT INTO public.payment_transactions (
      amount,
      currency,
      idempotency_key
    ) VALUES (120.00, 'ILS', 'ledger-test-payment-1');
    RETURN FALSE;
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  UPDATE public.payment_transactions
  SET provider_transaction_id = 'provider-transaction-1'
  WHERE id = payment_id;

  BEGIN
    INSERT INTO public.payment_transactions (
      amount,
      currency,
      idempotency_key,
      provider_transaction_id
    ) VALUES (120.00, 'ILS', 'ledger-test-payment-2', 'provider-transaction-1');
    RETURN FALSE;
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.payment_transactions (
      amount,
      currency,
      idempotency_key
    ) VALUES (120.00, 'ILS', ' ledger-test-payment-3 ');
    RETURN FALSE;
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.payment_transactions (
      amount,
      currency,
      idempotency_key,
      checkout_snapshot
    ) VALUES (
      120.00,
      'ILS',
      'ledger-test-payment-4',
      '{"card_num":"not-allowed"}'::JSONB
    );
    RETURN FALSE;
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  UPDATE public.payment_transactions
  SET status = 'succeeded', verified_at = NOW()
  WHERE id = payment_id;

  SELECT count(*)
  INTO event_count
  FROM public.payment_transaction_events
  WHERE payment_transaction_id = payment_id;

  IF event_count <> 2 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.payment_transactions (
    id,
    operation,
    parent_transaction_id,
    amount,
    currency,
    idempotency_key
  ) VALUES (
    refund_id,
    'refund',
    payment_id,
    120.00,
    'ILS',
    'ledger-test-refund-1'
  );

  BEGIN
    INSERT INTO public.payment_transactions (
      operation,
      parent_transaction_id,
      amount,
      currency,
      idempotency_key
    ) VALUES (
      'refund',
      refund_id,
      120.00,
      'ILS',
      'ledger-test-refund-2'
    );
    RETURN FALSE;
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.payment_transactions
    SET amount = 121.00
    WHERE id = payment_id;
    RETURN FALSE;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.payment_transaction_events
    SET metadata = '{}'::JSONB
    WHERE payment_transaction_id = payment_id;
    RETURN FALSE;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    TRUNCATE TABLE public.payment_transaction_events;
    RETURN FALSE;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM public.payment_transactions WHERE id = payment_id;
    RETURN FALSE;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  RETURN TRUE;
END;
$$;

SELECT extensions.ok(
  pg_temp.payment_ledger_behavior_is_valid(),
  'ledger uniqueness, validation, parentage, events, and immutability work'
);

SET LOCAL ROLE anon;

SELECT extensions.throws_ok(
  $$INSERT INTO public.payment_transactions (amount, currency, idempotency_key)
    VALUES (1.00, 'ILS', 'anon-payment-1')$$,
  '42501', NULL, 'anon cannot insert payment transactions'
);
SELECT extensions.throws_ok(
  $$TRUNCATE TABLE public.payment_transaction_events$$,
  '42501', NULL, 'anon cannot truncate payment events'
);

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$INSERT INTO public.payment_transactions (amount, currency, idempotency_key)
    VALUES (1.00, 'ILS', 'authenticated-payment-1')$$,
  '42501', NULL, 'authenticated cannot insert payment transactions'
);
SELECT extensions.throws_ok(
  $$UPDATE public.payment_transactions SET status = 'failed' WHERE false$$,
  '42501', NULL, 'authenticated cannot update payment transactions'
);
SELECT extensions.throws_ok(
  $$DELETE FROM public.payment_transactions WHERE false$$,
  '42501', NULL, 'authenticated cannot delete payment transactions'
);
SELECT extensions.throws_ok(
  $$TRUNCATE TABLE public.payment_transactions$$,
  '42501', NULL, 'authenticated cannot truncate payment transactions'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.payment_transaction_events
    (payment_transaction_id, event_type, status)
    VALUES ('00000000-0000-0000-0000-000000000001', 'forbidden', 'failed')$$,
  '42501', NULL, 'authenticated cannot insert payment events'
);
SELECT extensions.throws_ok(
  $$UPDATE public.payment_transaction_events SET metadata = '{}'::JSONB WHERE false$$,
  '42501', NULL, 'authenticated cannot update payment events'
);
SELECT extensions.throws_ok(
  $$DELETE FROM public.payment_transaction_events WHERE false$$,
  '42501', NULL, 'authenticated cannot delete payment events'
);
SELECT extensions.throws_ok(
  $$TRUNCATE TABLE public.payment_transaction_events$$,
  '42501', NULL, 'authenticated cannot truncate payment events'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
