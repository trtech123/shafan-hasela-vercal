-- PostgreSQL bounds in regular expressions cannot exceed 255. Keep the exact
-- allowed identifier alphabet and 1..300 length with a separate length check.
-- No history/state rewrite, permission change, or dispatch/finalization change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.order_delivery_attempts
 DROP CONSTRAINT order_delivery_attempts_provider_message_id_check,
 ADD CONSTRAINT order_delivery_attempts_provider_message_id_check CHECK (
  provider_message_id IS NULL OR
  (length(provider_message_id) BETWEEN 1 AND 300 AND provider_message_id ~ '^[A-Za-z0-9._:@+/=<>-]+$')
 );
ALTER TABLE public.quotation_delivery_attempts
 DROP CONSTRAINT quotation_delivery_attempts_provider_message_id_check,
 ADD CONSTRAINT quotation_delivery_attempts_provider_message_id_check CHECK (
  provider_message_id IS NULL OR
  (length(provider_message_id) BETWEEN 1 AND 300 AND provider_message_id ~ '^[A-Za-z0-9._:@+/=<>-]+$')
 );
COMMIT;
