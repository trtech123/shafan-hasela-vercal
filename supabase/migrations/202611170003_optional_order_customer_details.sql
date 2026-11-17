-- Orders can be scheduled before staff obtain customer contact details.
-- Payment and document eligibility remain governed by their existing gates.
ALTER TABLE public.orders ALTER COLUMN client_name DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN client_phone DROP NOT NULL;

COMMENT ON COLUMN public.orders.client_name IS
  'Optional customer name supplied by staff; NULL means not collected.';
COMMENT ON COLUMN public.orders.client_phone IS
  'Optional customer phone supplied by staff; NULL means not collected.';
