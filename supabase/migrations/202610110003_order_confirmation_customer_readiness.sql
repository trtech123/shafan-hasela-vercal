BEGIN;
-- No historical data or artifacts are rewritten. IDs remain valid when present.
ALTER TABLE public.order_confirmation_revisions DROP CONSTRAINT new_signed_requires_signer_id;
CREATE FUNCTION public.order_signature_readiness(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; s public.customer_snapshots; c public.customers; missing jsonb:='[]'; identification text;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='PT404'; END IF;
 SELECT * INTO c FROM public.customers WHERE id=o.customer_id FOR SHARE;
 IF NOT FOUND OR c.archived_at IS NOT NULL THEN missing=missing||'"active_customer"'::jsonb; END IF;
 SELECT * INTO s FROM public.customer_snapshots WHERE id=o.customer_snapshot_id;
 IF NOT FOUND OR s.order_id IS DISTINCT FROM o.id OR s.customer_id IS DISTINCT FROM o.customer_id
 OR s.revision IS DISTINCT FROM o.customer_record_version OR s.data IS DISTINCT FROM public.customer_snapshot_data(to_jsonb(o)) THEN
  RETURN missing||'"customer_snapshot"'::jsonb;
 END IF;
 -- Validate the immutable order snapshot, never the current master values/version.
 IF nullif(btrim(s.data->>'client_name'),'') IS NULL THEN missing=missing||'"customer_name"'::jsonb; END IF;
 IF coalesce(nullif(btrim(s.data->>'billing_institution_name'),''),nullif(btrim(s.data->>'client_name'),'')) IS NULL THEN missing=missing||'"billing_name"'::jsonb; END IF;
 identification=regexp_replace(coalesce(s.data->>'billing_company_id',''),'[[:space:]-]','','g');
 IF identification='000000000' OR identification !~ '^[0-9]{9}$' OR (s.customer_kind='person' AND NOT public.order_signature_valid_israeli_id(identification)) THEN missing=missing||'"billing_identification"'::jsonb; END IF;
 IF jsonb_typeof(s.data->'vat_applicable') IS DISTINCT FROM 'boolean' THEN missing=missing||'"vat_applicable"'::jsonb; END IF;
 IF length(public.customer_normalize_phone(s.data->>'client_phone')) NOT BETWEEN 9 AND 15 THEN missing=missing||'"customer_phone"'::jsonb; END IF;
 IF o.activity_date IS NULL OR o.num_participants IS NULL OR o.num_participants<1 THEN missing=missing||'"order_details"'::jsonb; END IF;
 RETURN missing;
END $$;
REVOKE ALL ON FUNCTION public.order_signature_readiness(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.order_signature_action(p_action text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.order_confirmation_revisions; d jsonb; actor uuid; oid uuid; rid uuid; seq integer; result jsonb; vat jsonb; fixed_text jsonb; signer_id_value text; missing jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'signature_forbidden' USING ERRCODE='42501'; END IF;
 IF p_action IN ('create','history','staff_read','revoke','ready') THEN
  actor=(p_input->>'actorId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND role IN ('admin','operations','cashier')) THEN RAISE EXCEPTION 'signature_forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_action='create' THEN
  oid=(p_input->>'orderId')::uuid;
  PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='PT404'; END IF;
  IF (p_input->>'days')::integer NOT BETWEEN 1 AND 30 OR jsonb_typeof(p_input->'text')<>'object' OR length(p_input->>'acceptanceText') NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  missing=public.order_signature_readiness(oid);
  IF jsonb_array_length(missing)>0 THEN RAISE EXCEPTION 'billing_customer_incomplete' USING ERRCODE='PT409',DETAIL=missing::text; END IF;
  d=public.order_signature_customer_data(public.order_confirmation_data(oid));
  vat=CASE WHEN (d->'customer_snapshot') ? 'vat_applicable' THEN d->'customer_snapshot'->'vat_applicable' WHEN d ? 'vat_applicable' THEN d->'vat_applicable' ELSE d->'quotation_snapshot'->'vat_applicable' END;
  fixed_text=jsonb_set(p_input->'text','{ORDER_TERMS,0}',to_jsonb(CASE WHEN vat='true'::jsonb THEN 'חייב במע״מ — המחירים כוללים מע״מ' WHEN vat='false'::jsonb THEN 'מע״מ לא חל לפי ההחלטה השמורה להזמנה' ELSE 'החלטת מע״מ היסטורית לא תועדה; לא הונח חיוב או פטור' END));
  SELECT coalesce(max(revision_number),0)+1 INTO seq FROM public.order_confirmation_revisions WHERE order_id=oid;
  UPDATE public.order_confirmation_revisions SET status='superseded' WHERE order_id=oid AND status IN ('preparing','pending','signing');
  rid=extensions.uuid_generate_v4();
  INSERT INTO public.order_confirmation_revisions(id,order_id,revision_number,snapshot,source_version,token_hash,created_by,expires_at)
  VALUES(rid,oid,seq,jsonb_build_object('revisionId',rid,'revisionNumber',seq,'data',d,'text',fixed_text,'renderVersion',p_input->>'renderVersion','acceptanceVersion',p_input->>'acceptanceVersion','acceptanceText',p_input->>'acceptanceText'),md5(d::text),p_input->>'tokenHash',actor,now()+make_interval(days=>(p_input->>'days')::integer)) RETURNING * INTO r;
 ELSIF p_action='history' THEN
  oid=(p_input->>'orderId')::uuid; d=public.order_signature_customer_data(public.order_confirmation_data(oid));
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'revision_number',revision_number,'revision_hash',revision_hash,'status',CASE WHEN status IN ('pending','preparing','signing') AND expires_at<=now() THEN 'expired' ELSE status END,'created_at',created_at,'expires_at',expires_at,'signed_at',CASE WHEN status='signed' THEN signed_at END,'full_name',CASE WHEN status='signed' THEN full_name END,'signer_id',CASE WHEN status='signed' THEN signer_id END,'current_differs',source_version<>md5(d::text)) ORDER BY revision_number DESC),'[]'::jsonb) INTO result FROM public.order_confirmation_revisions WHERE order_id=oid;
  RETURN jsonb_build_object('readiness',public.order_signature_readiness(oid),'customerReview',(SELECT jsonb_build_object('customerId',customer_id,'version',customer_record_version) FROM public.orders WHERE id=oid),'revisions',result,'deliveries',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC),'[]'::jsonb) FROM public.order_signature_deliveries a JOIN public.order_confirmation_revisions rev ON a.revision_id=rev.id WHERE rev.order_id=oid));
 ELSE
  IF p_action IN ('view','claim','finish') THEN
   SELECT * INTO r FROM public.order_confirmation_revisions WHERE token_hash=p_input->>'tokenHash' FOR UPDATE;
   IF NOT FOUND OR r.status IN ('preparing','revoked','superseded') OR r.expires_at<=now() THEN RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404'; END IF;
   -- A changed order must never be silently signed as its previous revision.
   IF r.status<>'signed' AND r.source_version<>md5(public.order_signature_customer_data(public.order_confirmation_data(r.order_id))::text) THEN RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404'; END IF;
  ELSE
   SELECT * INTO r FROM public.order_confirmation_revisions WHERE id=(p_input->>'revisionId')::uuid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='PT404'; END IF;
  END IF;
  IF p_action='ready' THEN
   IF r.status<>'preparing' THEN RAISE EXCEPTION 'revision_conflict' USING ERRCODE='PT409'; END IF;
   UPDATE public.order_confirmation_revisions SET revision_hash=p_input->>'revisionHash',unsigned_hash=p_input->>'unsignedHash',unsigned_path=id::text||'/unsigned.pdf',status='pending' WHERE id=r.id RETURNING * INTO r;
  ELSIF p_action='revoke' THEN
   IF r.status IN ('preparing','pending','signing') THEN UPDATE public.order_confirmation_revisions SET status='revoked' WHERE id=r.id RETURNING * INTO r; END IF;
  ELSIF p_action='claim' THEN
   signer_id_value=NULL;
   IF p_input ? 'signerId' THEN
    IF jsonb_typeof(p_input->'signerId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid_signer_id'; END IF;
    signer_id_value=regexp_replace(p_input->>'signerId','[[:space:]-]','','g');
    IF NOT public.order_signature_valid_israeli_id(signer_id_value) THEN RAISE EXCEPTION 'invalid_signer_id'; END IF;
   END IF;
   IF r.status='signed' OR (r.status='signing' AND (r.claim_expires_at>now() OR r.request_id=(p_input->>'requestId')::uuid)) THEN
    IF r.request_id IS DISTINCT FROM (p_input->>'requestId')::uuid OR r.signer_id IS DISTINCT FROM signer_id_value OR r.full_name IS DISTINCT FROM p_input->>'fullName' OR r.strokes IS DISTINCT FROM p_input->'strokes' THEN RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404'; END IF;
   ELSE
    IF p_input->>'accepted' IS DISTINCT FROM 'true' OR coalesce(length(p_input->>'fullName'),0) NOT BETWEEN 3 AND 120 OR jsonb_typeof(p_input->'strokes') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'strokes') NOT BETWEEN 1 AND 64 OR p_input->>'requestId' IS NULL THEN RAISE EXCEPTION 'invalid_signature'; END IF;
    IF EXISTS(SELECT 1 FROM public.order_confirmation_signature_claims WHERE revision_id=r.id AND request_id=(p_input->>'requestId')::uuid) THEN RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404'; END IF;
    INSERT INTO public.order_confirmation_signature_claims(revision_id,request_id) VALUES(r.id,(p_input->>'requestId')::uuid);
    UPDATE public.order_confirmation_revisions SET status='signing',request_id=(p_input->>'requestId')::uuid,full_name=p_input->>'fullName',signer_id=signer_id_value,strokes=p_input->'strokes',signed_at=clock_timestamp(),claim_expires_at=clock_timestamp()+interval '2 minutes' WHERE id=r.id RETURNING * INTO r;
   END IF;
  ELSIF p_action='finish' THEN
   IF r.request_id IS DISTINCT FROM (p_input->>'requestId')::uuid OR r.status NOT IN ('signing','signed') THEN RAISE EXCEPTION 'link_unavailable' USING ERRCODE='PT404'; END IF;
   IF r.status='signing' THEN
    UPDATE public.order_confirmation_revisions SET status='signed',signed_hash=p_input->>'signedHash',signed_path=id::text||'/'||request_id::text||'-signed.pdf' WHERE id=r.id RETURNING * INTO r;
   ELSIF r.signed_hash IS DISTINCT FROM p_input->>'signedHash' THEN RAISE EXCEPTION 'revision_conflict' USING ERRCODE='PT409'; END IF;
  ELSIF p_action NOT IN ('view','staff_read') THEN RAISE EXCEPTION 'invalid_request';
  END IF;
 END IF;
 RETURN to_jsonb(r)-'token_hash';
END $$;
REVOKE ALL ON FUNCTION public.order_signature_action(text,jsonb),public.protect_order_signature_evidence() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.order_signature_action(text,jsonb) TO service_role;

COMMIT;
