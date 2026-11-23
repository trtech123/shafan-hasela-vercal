BEGIN;

-- Reuse the reviewed safety boundary from payment-integration-20261122.
-- New browser receipts must be finalized by verified server workflows.
-- Existing sales and provider evidence are never modified.
REVOKE INSERT ON TABLE public.sales FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.sales TO service_role;

-- Retire the legacy order RPC that could mark an order paid without a Payper
-- obligation. Guarded cash/check collection uses payper-noncard-collection.
REVOKE EXECUTE ON FUNCTION public.complete_manual_order_payment(uuid,text,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.sales', 'INSERT') OR
     has_table_privilege('authenticated', 'public.sales', 'INSERT') OR
     NOT has_table_privilege('service_role', 'public.sales', 'INSERT') OR
     has_function_privilege('authenticated',
       'public.complete_manual_order_payment(uuid,text,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'verified_sale_source_grants_invalid';
  END IF;
END $$;

COMMIT;
