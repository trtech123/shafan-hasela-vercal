-- Local preparation only. No activation cutoff or dispatch is set by this migration.
-- Review existing Rivhit documents and in-flight attempts before activation.
BEGIN;

CREATE TABLE public.payper_document_ledger (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 payment_id uuid NOT NULL UNIQUE REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
 sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'eligible' CHECK (state IN
  ('eligible','source_frozen','source_blocked','dispatch_reserved','reconciliation_required','succeeded')),
 source_facts jsonb,
 source_frozen_at timestamptz,
 dispatch_reserved_at timestamptz,
 reconciliation_code text CHECK (reconciliation_code IS NULL OR reconciliation_code ~ '^[a-z0-9_]{1,80}$'),
 reconciliation_evidence jsonb,
 document_number text UNIQUE,
 document_url text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((source_facts IS NULL AND source_frozen_at IS NULL AND state IN ('eligible','source_blocked'))
   OR (source_facts IS NOT NULL AND source_frozen_at IS NOT NULL AND state<>'eligible')),
 CHECK (dispatch_reserved_at IS NULL OR source_frozen_at IS NOT NULL),
 CHECK (state NOT IN ('dispatch_reserved','reconciliation_required','succeeded') OR dispatch_reserved_at IS NOT NULL),
 CHECK (state<>'succeeded' OR (document_number IS NOT NULL AND document_url IS NOT NULL))
);
CREATE UNIQUE INDEX payper_document_ledger_order_unique ON public.payper_document_ledger(order_id);
CREATE UNIQUE INDEX payper_document_ledger_sale_unique ON public.payper_document_ledger(sale_id);
ALTER TABLE public.payper_document_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payper_document_ledger FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY payper_ledger_admin_read ON public.payper_document_ledger FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role::text='admin'));
GRANT SELECT ON public.payper_document_ledger TO authenticated, service_role;

-- One private, immutable billing snapshot per payment attempt. Payment and
-- document workers use the frozen copy; browsers cannot query this table.
CREATE TABLE public.payper_payment_billing_snapshots (
 payment_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
 source_customer_snapshot_id uuid REFERENCES public.customer_snapshots(id) ON DELETE RESTRICT,
 customer_kind text CHECK(customer_kind IN ('person','organization')),
 billing_name text,
 billing_identity text,
 billing_email text,
 vat_applicable boolean,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.payper_payment_billing_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payper_payment_billing_snapshots FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.reject_payper_billing_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'payper_billing_snapshot_immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER trg_payper_billing_immutable BEFORE UPDATE OR DELETE
 ON public.payper_payment_billing_snapshots FOR EACH ROW
 EXECUTE FUNCTION public.reject_payper_billing_mutation();
REVOKE ALL ON FUNCTION public.reject_payper_billing_mutation() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.payper_valid_person_identity(p_identity text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE n integer; digit integer; product integer; total integer:=0;
BEGIN
 IF p_identity IS NULL OR p_identity !~ '^[0-9]{9}$' OR p_identity='000000000' THEN RETURN false; END IF;
 FOR n IN 1..9 LOOP
  digit:=substring(p_identity FROM n FOR 1)::integer;
  product:=digit * CASE WHEN n % 2=0 THEN 2 ELSE 1 END;
  total:=total + product / 10 + product % 10;
 END LOOP;
 RETURN total % 10=0;
END
$$;
REVOKE ALL ON FUNCTION public.payper_valid_person_identity(text) FROM PUBLIC,anon,authenticated,service_role;

-- NULL means no Payper ownership. A later reviewed activation transaction must
-- set this DB-clock instant; PostgreSQL timestamptz comparisons use UTC instants.
-- The installed dispatch constraint remains false independently.
CREATE TABLE public.payper_dispatch_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 enabled boolean NOT NULL DEFAULT false CHECK (enabled=false),
 dispatch_remaining integer NOT NULL DEFAULT 0 CHECK (dispatch_remaining>=0),
 activation_cutoff_utc timestamptz
);
INSERT INTO public.payper_dispatch_control(singleton,enabled,activation_cutoff_utc)
VALUES(true,false,NULL);
ALTER TABLE public.payper_dispatch_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payper_dispatch_control FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.payper_dispatch_control TO service_role;
CREATE FUNCTION public.lock_payper_activation_cutoff() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.activation_cutoff_utc IS NULL AND NEW.activation_cutoff_utc IS NOT NULL
 AND NEW.activation_cutoff_utc < statement_timestamp()
 THEN RAISE EXCEPTION 'payper_activation_cutoff_backdated' USING ERRCODE='23514'; END IF;
 IF OLD.activation_cutoff_utc IS NOT NULL
 AND NEW.activation_cutoff_utc IS DISTINCT FROM OLD.activation_cutoff_utc
 THEN RAISE EXCEPTION 'payper_activation_cutoff_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_lock_payper_activation_cutoff BEFORE UPDATE ON public.payper_dispatch_control
 FOR EACH ROW EXECUTE FUNCTION public.lock_payper_activation_cutoff();
REVOKE ALL ON FUNCTION public.lock_payper_activation_cutoff() FROM PUBLIC,anon,authenticated,service_role;

-- The payment finalizer remains unchanged. The existing verified-payment trigger
-- creates the Rivhit event, and this trigger records only Payper eligibility.
CREATE FUNCTION public.capture_payper_eligible_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cutoff timestamptz; review_code text;
BEGIN
 SELECT activation_cutoff_utc INTO cutoff FROM public.payper_dispatch_control WHERE singleton;
 IF NEW.provider='pelecard' AND NEW.operation='payment' AND NEW.status='succeeded'
 AND NEW.verified_at IS NOT NULL AND NEW.provider_transaction_id IS NOT NULL
 AND NEW.order_id IS NOT NULL AND NEW.sale_id IS NOT NULL
 AND cutoff IS NOT NULL AND NEW.created_at>=cutoff AND NEW.verified_at>=cutoff
 AND NEW.verified_at>=NEW.created_at
 AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'succeeded') THEN
  SELECT CASE
   WHEN b.payment_id IS NULL OR b.order_id IS DISTINCT FROM NEW.order_id
    OR c.id IS NULL OR b.source_customer_snapshot_id IS DISTINCT FROM c.id
    OR c.order_id IS DISTINCT FROM o.id OR c.customer_id IS DISTINCT FROM o.customer_id
    OR c.revision IS DISTINCT FROM o.customer_record_version
    THEN 'billing_snapshot_required'
   WHEN b.vat_applicable IS NULL OR jsonb_typeof(c.data->'vat_applicable') IS DISTINCT FROM 'boolean'
    THEN 'vat_treatment_required'
   WHEN b.vat_applicable IS DISTINCT FROM (c.data->>'vat_applicable')::boolean
    THEN 'vat_treatment_required'
   WHEN b.customer_kind NOT IN ('person','organization') OR b.customer_kind IS NULL
    OR nullif(btrim(b.billing_name),'') IS NULL OR b.billing_identity !~ '^[0-9]{9}$'
    OR b.billing_identity IS NULL THEN 'billing_identity_required'
   WHEN b.customer_kind='person' AND NOT public.payper_valid_person_identity(b.billing_identity)
    THEN 'billing_identity_required'
   WHEN b.billing_email IS NULL OR b.billing_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    THEN 'billing_email_required'
   ELSE NULL END INTO review_code
  FROM public.orders o LEFT JOIN public.customer_snapshots c ON c.id=o.customer_snapshot_id
   LEFT JOIN public.payper_payment_billing_snapshots b ON b.payment_id=NEW.id
  WHERE o.id=NEW.order_id;
  IF NOT FOUND THEN review_code:='billing_snapshot_required'; END IF;
  INSERT INTO public.payper_document_ledger(payment_id,order_id,sale_id,state,reconciliation_code)
  VALUES(NEW.id,NEW.order_id,NEW.sale_id,
   CASE WHEN review_code IS NULL THEN 'eligible' ELSE 'source_blocked' END,review_code)
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_payper_eligible_payment AFTER INSERT OR UPDATE OF status
 ON public.payment_transactions FOR EACH ROW
 EXECUTE FUNCTION public.capture_payper_eligible_payment();
REVOKE ALL ON FUNCTION public.capture_payper_eligible_payment() FROM PUBLIC,anon,authenticated,service_role;

-- Database-side fence also protects old deployed workers and force-retry calls.
-- Other Rivhit accounting purposes, including non-Pelecard bookkeeping, stay intact.
CREATE FUNCTION public.hold_rivhit_pelecard_issuance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cutoff timestamptz;
BEGIN
 SELECT activation_cutoff_utc INTO cutoff FROM public.payper_dispatch_control WHERE singleton;
 IF NEW.accounting_provider='rivhit' AND NEW.purpose='payment_success'
 AND NEW.source_type IN ('payment_transaction','sale') AND cutoff IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.payment_transactions p
   WHERE ((NEW.source_type='payment_transaction' AND p.id::text=NEW.source_id)
     OR (NEW.source_type='sale' AND p.sale_id::text=NEW.source_id))
   AND p.provider='pelecard' AND p.operation='payment'
   AND p.created_at>=cutoff) THEN
  IF TG_OP='INSERT' THEN
   NEW.status:='configuration_required';
   NEW.last_error:='{"code":"payper_transition_hold"}'::jsonb;
  ELSIF NEW.status='processing' THEN
   RAISE EXCEPTION 'payper_transition_hold' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_hold_rivhit_pelecard_issuance BEFORE INSERT OR UPDATE OF status
 ON public.accounting_events FOR EACH ROW EXECUTE FUNCTION public.hold_rivhit_pelecard_issuance();
REVOKE ALL ON FUNCTION public.hold_rivhit_pelecard_issuance() FROM PUBLIC,anon,authenticated,service_role;

-- The direct Rivhit order workflow bypasses accounting_events and claims an
-- accounting_documents row before calling Rivhit. Fence that claim as well.
CREATE FUNCTION public.hold_rivhit_pelecard_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cutoff timestamptz;
BEGIN
 SELECT activation_cutoff_utc INTO cutoff FROM public.payper_dispatch_control WHERE singleton;
 IF NEW.provider='rivhit' AND NEW.status='processing'
 AND cutoff IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.payment_transactions p
   WHERE p.provider='pelecard' AND p.operation='payment'
   AND p.created_at>=cutoff
   AND ((NEW.source_type='order' AND p.order_id::text=NEW.source_id)
     OR (NEW.source_type='payment_transaction' AND p.id::text=NEW.source_id)
     OR (NEW.source_type='sale' AND p.sale_id::text=NEW.source_id)))
 THEN RAISE EXCEPTION 'payper_transition_hold' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_hold_rivhit_pelecard_document BEFORE INSERT OR UPDATE OF status
 ON public.accounting_documents FOR EACH ROW
 EXECUTE FUNCTION public.hold_rivhit_pelecard_document();
REVOKE ALL ON FUNCTION public.hold_rivhit_pelecard_document() FROM PUBLIC,anon,authenticated,service_role;

-- The separate immediate-sale path can otherwise issue a second Rivhit customer
-- document for the same Pelecard payment. Prevent customer creation and dispatch.
CREATE FUNCTION public.hold_pelecard_immediate_rivhit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cutoff timestamptz;
BEGIN
 SELECT activation_cutoff_utc INTO cutoff FROM public.payper_dispatch_control WHERE singleton;
 IF NEW.payment_id IS NOT NULL AND NEW.method='pelecard'
 AND cutoff IS NOT NULL AND EXISTS(SELECT 1 FROM public.payment_transactions p
   WHERE p.id=NEW.payment_id AND p.provider='pelecard' AND p.operation='payment'
   AND p.created_at>=cutoff)
 AND ((OLD.customer_creation_started_at IS NULL AND NEW.customer_creation_started_at IS NOT NULL)
   OR (OLD.dispatch_started_at IS NULL AND NEW.dispatch_started_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'payper_transition_hold' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_hold_pelecard_immediate_rivhit BEFORE UPDATE
 ON public.immediate_accounting_preparations FOR EACH ROW
 EXECUTE FUNCTION public.hold_pelecard_immediate_rivhit();
REVOKE ALL ON FUNCTION public.hold_pelecard_immediate_rivhit() FROM PUBLIC,anon,authenticated,service_role;

-- Immutable local source facts. This is eligibility preparation, never permission
-- to issue: no document type, VAT rate, currency unit, or provider payload is inferred.
CREATE FUNCTION public.freeze_payper_source(p_payment_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.payper_document_ledger%ROWTYPE; p public.payment_transactions%ROWTYPE;
 o public.orders%ROWTYPE; s public.sales%ROWTYPE; c public.customer_snapshots%ROWTYPE;
 b public.payper_payment_billing_snapshots%ROWTYPE; facts jsonb; cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT activation_cutoff_utc INTO cutoff FROM public.payper_dispatch_control WHERE singleton;
 IF cutoff IS NULL THEN RAISE EXCEPTION 'payper_activation_fence'; END IF;
 SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'payper_payment_not_eligible'; END IF;
 IF l.state<>'eligible' THEN RETURN l.source_facts; END IF;
 SELECT * INTO p FROM public.payment_transactions WHERE id=l.payment_id;
 SELECT * INTO o FROM public.orders WHERE id=l.order_id;
 SELECT * INTO s FROM public.sales WHERE id=l.sale_id;
 SELECT * INTO c FROM public.customer_snapshots WHERE id=o.customer_snapshot_id;
 SELECT * INTO b FROM public.payper_payment_billing_snapshots WHERE payment_id=p_payment_id;
 IF p.provider IS DISTINCT FROM 'pelecard' OR p.operation IS DISTINCT FROM 'payment'
 OR p.status IS DISTINCT FROM 'succeeded' OR p.verified_at IS NULL
 OR p.created_at<cutoff OR p.verified_at<cutoff OR p.created_at IS NULL
 OR p.verified_at<p.created_at
 OR p.provider_transaction_id IS NULL OR p.currency IS DISTINCT FROM 'ILS'
 OR p.order_id IS DISTINCT FROM o.id OR p.sale_id IS DISTINCT FROM s.id
 OR s.order_id IS DISTINCT FROM o.id OR s.payment_transaction_id IS DISTINCT FROM p.id
 OR p.amount IS DISTINCT FROM s.total OR p.amount IS DISTINCT FROM o.total_price
 OR c.id IS NULL OR c.order_id IS DISTINCT FROM o.id OR c.customer_id IS DISTINCT FROM o.customer_id
 OR c.revision IS DISTINCT FROM o.customer_record_version
 OR b.payment_id IS NULL OR b.order_id IS DISTINCT FROM o.id
 OR b.source_customer_snapshot_id IS DISTINCT FROM c.id
 OR b.vat_applicable IS NULL OR jsonb_typeof(c.data->'vat_applicable') IS DISTINCT FROM 'boolean'
 OR b.vat_applicable IS DISTINCT FROM (CASE WHEN jsonb_typeof(c.data->'vat_applicable')='boolean'
   THEN (c.data->>'vat_applicable')::boolean ELSE NULL END)
 OR b.customer_kind NOT IN ('person','organization') OR b.customer_kind IS NULL
 OR nullif(btrim(b.billing_name),'') IS NULL OR b.billing_identity !~ '^[0-9]{9}$'
 OR b.billing_identity IS NULL OR b.billing_identity='000000000'
 OR (b.customer_kind='person' AND NOT public.payper_valid_person_identity(b.billing_identity))
 OR b.billing_email IS NULL OR b.billing_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 OR jsonb_typeof(p.checkout_snapshot->'items') IS DISTINCT FROM 'array'
 OR jsonb_array_length(CASE WHEN jsonb_typeof(p.checkout_snapshot->'items')='array'
   THEN p.checkout_snapshot->'items' ELSE '[]'::jsonb END)=0
 THEN RAISE EXCEPTION 'payper_source_incomplete'; END IF;
 facts:=jsonb_build_object('paymentId',p.id,'pelecardTransactionId',p.provider_transaction_id,
  'paymentCreatedAt',p.created_at,'verifiedAt',p.verified_at,
  'activationCutoffUtc',cutoff,'amount',p.amount,'currency',p.currency,
  'checkoutSnapshot',p.checkout_snapshot,'saleId',s.id,'orderId',o.id,
  'orderNumber',o.order_number,'customerSnapshotId',c.id,'customerId',c.customer_id,
  'customerKind',b.customer_kind,'customerVersion',c.customer_version,
  'customerRevision',c.revision,'billing',jsonb_build_object(
   'vat_applicable',b.vat_applicable,'billing_institution_name',b.billing_name,
   'billing_company_id',b.billing_identity,'billing_accounting_email',b.billing_email));
 UPDATE public.payper_document_ledger SET state='source_frozen',source_facts=facts,
  source_frozen_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=l.id;
 RETURN facts;
END $$;
REVOKE ALL ON FUNCTION public.freeze_payper_source(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.freeze_payper_source(uuid) TO service_role;

-- No update grant exists for this switch, and the migration never enables it.
CREATE FUNCTION public.reserve_payper_dispatch(p_payment_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.payper_document_ledger%ROWTYPE; p public.payment_transactions%ROWTYPE;
 cutoff timestamptz;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT activation_cutoff_utc INTO cutoff FROM public.payper_dispatch_control WHERE singleton AND enabled;
 IF cutoff IS NULL
 THEN RAISE EXCEPTION 'payper_dispatch_disabled' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
 IF NOT FOUND OR l.state<>'source_frozen' THEN RAISE EXCEPTION 'payper_dispatch_fence'; END IF;
 SELECT * INTO p FROM public.payment_transactions WHERE id=p_payment_id;
 IF p.provider IS DISTINCT FROM 'pelecard' OR p.operation IS DISTINCT FROM 'payment'
 OR p.status IS DISTINCT FROM 'succeeded' OR p.created_at<cutoff OR p.verified_at<cutoff
 OR p.created_at IS NULL OR p.verified_at IS NULL OR p.verified_at<p.created_at
 THEN RAISE EXCEPTION 'payper_activation_fence'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_documents d
   WHERE (d.source_type='payment_transaction' AND d.source_id=p_payment_id::text)
   OR (d.source_type='order' AND d.source_id=l.order_id::text)
   OR (d.source_type='sale' AND d.source_id=l.sale_id::text))
 OR EXISTS(SELECT 1 FROM public.immediate_accounting_preparations a
   WHERE a.payment_id=p_payment_id AND a.dispatch_started_at IS NOT NULL)
 THEN RAISE EXCEPTION 'existing_accounting_document_or_dispatch'; END IF;
 UPDATE public.payper_dispatch_control SET dispatch_remaining=dispatch_remaining-1
 WHERE singleton AND enabled AND dispatch_remaining>0 AND activation_cutoff_utc=cutoff;
 IF NOT FOUND THEN RAISE EXCEPTION 'payper_dispatch_limit_reached' USING ERRCODE='42501'; END IF;
 UPDATE public.payper_document_ledger SET state='dispatch_reserved',
  dispatch_reserved_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=l.id;
 RETURN l.id;
END $$;
REVOKE ALL ON FUNCTION public.reserve_payper_dispatch(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_payper_dispatch(uuid) TO service_role;

-- A failed preparation or read-only lookup stops automatic selection. This
-- cannot release or change a reserved request, including uncertain dispatches.
CREATE FUNCTION public.hold_payper_source(p_payment_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 UPDATE public.payper_document_ledger SET state='source_blocked',
  reconciliation_code='pre_dispatch_review_required',updated_at=clock_timestamp()
 WHERE payment_id=p_payment_id AND state IN ('eligible','source_frozen');
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.hold_payper_source(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hold_payper_source(uuid) TO service_role;

-- Once reservation succeeds in a future release, a failed send is always
-- reconciliation_required. No SQL transition from that state to dispatch exists.
CREATE FUNCTION public.record_payper_dispatch_outcome(
 p_payment_id uuid,p_state text,p_document_number text DEFAULT NULL,
 p_document_url text DEFAULT NULL,p_code text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.payper_document_ledger%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.payper_document_ledger WHERE payment_id=p_payment_id FOR UPDATE;
 IF NOT FOUND OR l.state<>'dispatch_reserved' THEN RAISE EXCEPTION 'payper_outcome_fence'; END IF;
 IF p_state='succeeded' THEN
  IF p_document_number IS NULL OR p_document_number !~ '^[0-9]+$'
   OR p_document_url IS NULL OR p_document_url !~ '^https://(app\.)?payper\.co\.il/'
  THEN RAISE EXCEPTION 'payper_success_evidence_required'; END IF;
  UPDATE public.payper_document_ledger SET state='succeeded',document_number=p_document_number,
   document_url=p_document_url,updated_at=clock_timestamp() WHERE id=l.id;
 ELSIF p_state='reconciliation_required' THEN
  IF p_code IS NULL OR p_code !~ '^[a-z0-9_]{1,80}$' THEN RAISE EXCEPTION 'payper_safe_code_required'; END IF;
  UPDATE public.payper_document_ledger SET state='reconciliation_required',
   reconciliation_code=p_code,updated_at=clock_timestamp() WHERE id=l.id;
 ELSE RAISE EXCEPTION 'payper_outcome_invalid'; END IF;
 RETURN p_state;
END $$;
REVOKE ALL ON FUNCTION public.record_payper_dispatch_outcome(uuid,text,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_payper_dispatch_outcome(uuid,text,text,text,text) TO service_role;

-- Manual evidence is reference-only and cannot release a reconciliation hold.
CREATE FUNCTION public.note_payper_reconciliation(
 p_payment_id uuid,p_actor_id uuid,p_reference text,p_note text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role::text='admin')
 THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501'; END IF;
 IF p_reference IS NULL OR p_reference !~ '^[A-Za-z0-9:/._-]{8,200}$'
 OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 500
 THEN RAISE EXCEPTION 'safe_reconciliation_evidence_required'; END IF;
 UPDATE public.payper_document_ledger SET reconciliation_evidence=jsonb_build_object(
  'reference',p_reference,'note',btrim(p_note),'actorId',p_actor_id,'recordedAt',clock_timestamp()),
  updated_at=clock_timestamp()
 WHERE payment_id=p_payment_id AND state IN ('reconciliation_required','source_blocked')
  AND reconciliation_evidence IS NULL;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.note_payper_reconciliation(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.note_payper_reconciliation(uuid,uuid,text,text) TO service_role;

-- The disabled switch requires a separate reviewed activation migration.
COMMIT;
