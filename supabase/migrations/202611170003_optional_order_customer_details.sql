-- Orders can be scheduled before staff obtain customer contact details.
-- Payment and document eligibility remain governed by their existing gates.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.orders ALTER COLUMN client_name DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN client_phone DROP NOT NULL;
COMMIT;
