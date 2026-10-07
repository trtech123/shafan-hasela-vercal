-- Read-only post-migration audit. Does not create permits or contact Rivhit.
BEGIN TRANSACTION READ ONLY;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.immediate_accounting_activation_permits) THEN
  RAISE EXCEPTION 'unexpected_accounting_activation_permit';
 END IF;
 IF has_table_privilege('service_role','public.immediate_accounting_activation_permits','INSERT')
 OR has_table_privilege('authenticated','public.immediate_accounting_activation_permits','INSERT')
 OR has_table_privilege('anon','public.immediate_accounting_activation_permits','INSERT') THEN
  RAISE EXCEPTION 'activation_permit_write_permission_exposed';
 END IF;
 IF has_function_privilege('authenticated','public.activate_immediate_accounting(uuid,uuid,text,text)','EXECUTE')
 OR has_function_privilege('anon','public.activate_immediate_accounting(uuid,uuid,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'public_activation_permission_exposed';
 END IF;
 IF position('INSERT INTO public.accounting_events' in pg_get_functiondef('public.prepare_immediate_accounting(uuid,uuid,jsonb,text,boolean)'::regprocedure))>0 THEN
  RAISE EXCEPTION 'preparation_still_enqueues_accounting';
 END IF;
 IF EXISTS(SELECT 1 FROM public.pelecard_controlled_live_control c WHERE c.payment_id IS NOT NULL AND NOT public.is_pelecard_controlled_live_accounting_held(c.payment_id::text)) THEN
  RAISE EXCEPTION 'historical_accounting_hold_missing';
 END IF;
 IF EXISTS(SELECT 1 FROM public.pelecard_live_attempts a WHERE NOT public.is_pelecard_controlled_live_accounting_held(a.payment_id::text)) THEN
  RAISE EXCEPTION 'permanent_accounting_hold_missing';
 END IF;
END $$;
SELECT 'intent_gate_closed'::text AS result;
ROLLBACK;
