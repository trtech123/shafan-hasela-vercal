BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$
DECLARE legacy public.order_confirmation_revisions; fresh jsonb; history jsonb; failed boolean; claim jsonb; bad jsonb;
BEGIN
 SELECT * INTO legacy FROM public.order_confirmation_revisions WHERE id='98200000-0000-4000-8000-000000000010';
 history=public.order_signature_action('history',jsonb_build_object('actorId',legacy.created_by,'orderId',legacy.order_id));
 IF history->'revisions'->0->>'legacy_without_signer_id'<>'true' OR history->'revisions'->0->>'signer_id' IS NOT NULL THEN RAISE EXCEPTION 'legacy history not labelled'; END IF;
 failed=false;BEGIN UPDATE public.order_confirmation_revisions SET signer_id='012345674' WHERE id=legacy.id;EXCEPTION WHEN insufficient_privilege THEN failed=true;END;
 IF NOT failed THEN RAISE EXCEPTION 'legacy evidence backfilled'; END IF;
 fresh=public.order_signature_action('create',jsonb_build_object('actorId',legacy.created_by,'orderId',legacy.order_id,'tokenHash',repeat('8',64),'days',7,'text','{"ORDER_TERMS":["original"]}'::jsonb,'renderVersion','2','acceptanceVersion','1','acceptanceText','I accept this precise frozen order document'));
 IF fresh->>'revision_number'<>'2' OR fresh->>'source_version'<>legacy.source_version THEN RAISE EXCEPTION 'unchanged legacy order cannot receive new revision'; END IF;
 fresh=public.order_signature_action('ready',jsonb_build_object('actorId',legacy.created_by,'revisionId',fresh->>'id','revisionHash',repeat('b',64),'unsignedHash',repeat('c',64)));
 claim=jsonb_build_object('tokenHash',repeat('8',64),'requestId','98200000-0000-4000-8000-000000000012','fullName','New Signer','strokes','[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb,'accepted',true);
 FOR bad IN SELECT value FROM jsonb_array_elements('[null,123456782,"","12345674","0012345674","012345675","01234567x","000000000"]') LOOP
  failed=false;BEGIN PERFORM public.order_signature_action('claim',claim||jsonb_build_object('signerId',bad));EXCEPTION WHEN OTHERS THEN IF SQLERRM='invalid_signer_id' THEN failed=true;ELSE RAISE;END IF;END;
  IF NOT failed THEN RAISE EXCEPTION 'invalid ID accepted';END IF;
 END LOOP;
 fresh=public.order_signature_action('claim',claim||'{"signerId":" 012-345 674 "}');
 IF fresh->>'signer_id'<>'012345674' THEN RAISE EXCEPTION 'normalization lost leading zero';END IF;
 history=public.order_signature_action('history',jsonb_build_object('actorId',legacy.created_by,'orderId',legacy.order_id));
 IF history->'revisions'->0->>'signer_id' IS NOT NULL THEN RAISE EXCEPTION 'provisional ID leaked to history';END IF;
 fresh=public.order_signature_action('finish',claim||jsonb_build_object('signedHash',repeat('d',64)));
 history=public.order_signature_action('history',jsonb_build_object('actorId',legacy.created_by,'orderId',legacy.order_id));
 IF history->'revisions'->0->>'signer_id'<>'012345674' OR history->'revisions'->0->>'legacy_without_signer_id'<>'false' THEN RAISE EXCEPTION 'new signed history lacks ID';END IF;
 failed=false;BEGIN UPDATE public.order_confirmation_revisions SET signer_id='123456782' WHERE id=(fresh->>'id')::uuid;EXCEPTION WHEN insufficient_privilege THEN failed=true;END;
 IF NOT failed THEN RAISE EXCEPTION 'new signed ID mutable';END IF;
END $$;
ROLLBACK;
