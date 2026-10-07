-- Post-deployment inspection only. No customer details or provider actions.
BEGIN READ ONLY;
SELECT p.proname,p.prosecdef,p.proconfig
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('order_confirmation_document','order_confirmation_data','claim_order_delivery','finish_order_delivery');
SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.order_delivery_attempts'::regclass;
SELECT polname,pg_catalog.pg_get_expr(polqual,polrelid) FROM pg_catalog.pg_policy WHERE polrelid='public.order_delivery_attempts'::regclass;
SELECT
 has_function_privilege('authenticated','public.order_confirmation_document(uuid)','EXECUTE') AS authenticated_preview,
 has_function_privilege('anon','public.order_confirmation_document(uuid)','EXECUTE') AS anon_preview,
 has_function_privilege('authenticated','public.claim_order_delivery(uuid,uuid,text,text,uuid,text,text)','EXECUTE') AS authenticated_claim,
 has_function_privilege('service_role','public.claim_order_delivery(uuid,uuid,text,text,uuid,text,text)','EXECUTE') AS service_claim,
 has_table_privilege('service_role','public.order_delivery_attempts','UPDATE') AS service_direct_update,
 has_table_privilege('authenticated','public.order_delivery_attempts','INSERT') AS authenticated_direct_insert;
SELECT state,count(*) FROM public.order_delivery_attempts GROUP BY state;
ROLLBACK;
