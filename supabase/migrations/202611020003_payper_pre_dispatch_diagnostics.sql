-- Classification only. This migration does not activate dispatch or rearm a held source.
BEGIN;

CREATE FUNCTION public.hold_payper_source(p_payment_id uuid, p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
  THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF p_code IS NULL OR p_code NOT IN (
    'provider_credentials_rejected', 'payper_lookup_failed', 'payper_transaction_mismatch',
    'payper_billing_incomplete', 'payper_email_required', 'payper_vat_contract_mismatch',
    'payper_items_required', 'payper_items_invalid', 'payper_amount_mismatch',
    'payper_description_required', 'payper_discount_mapping_required',
    'payper_freeze_source_failed', 'payper_reserve_dispatch_failed',
    'pre_dispatch_review_required'
  ) THEN RAISE EXCEPTION 'payper_safe_code_required' USING ERRCODE = '23514'; END IF;
  UPDATE public.payper_document_ledger
    SET state = 'source_blocked', reconciliation_code = p_code,
        updated_at = clock_timestamp()
    WHERE payment_id = p_payment_id AND state IN ('eligible', 'source_frozen')
      AND dispatch_reserved_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.hold_payper_source(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hold_payper_source(uuid,text) TO service_role;

-- Manual, audited pre-dispatch recovery only. This cannot reserve a request,
-- enable dispatch, alter the cutoff, or release a reserved/uncertain outcome.
CREATE FUNCTION public.rearm_payper_source_after_reconciliation(
  p_payment_id uuid, p_actor_id uuid, p_expected_trx_record_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  control_row public.payper_dispatch_control%ROWTYPE;
  ledger_row public.payper_document_ledger%ROWTYPE;
  payment_row public.payment_transactions%ROWTYPE;
  billing_row public.payper_payment_billing_snapshots%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role::text = 'admin'
  ) THEN RAISE EXCEPTION 'administrator_required' USING ERRCODE = '42501'; END IF;
  IF p_expected_trx_record_id IS NULL OR p_expected_trx_record_id !~ '^[1-9][0-9]{0,19}$'
  THEN RAISE EXCEPTION 'payper_reconciliation_evidence_required' USING ERRCODE = '23514'; END IF;
  SELECT * INTO control_row FROM public.payper_dispatch_control WHERE singleton FOR UPDATE;
  SELECT * INTO ledger_row FROM public.payper_document_ledger WHERE payment_id = p_payment_id FOR UPDATE;
  SELECT * INTO payment_row FROM public.payment_transactions WHERE id = p_payment_id;
  SELECT * INTO billing_row FROM public.payper_payment_billing_snapshots WHERE payment_id = p_payment_id;
  IF control_row.enabled OR control_row.dispatch_mode IS DISTINCT FROM 'canary'
    OR control_row.canary_payment_id IS DISTINCT FROM p_payment_id
    OR control_row.dispatch_remaining <> 1 OR control_row.activation_cutoff_utc IS NULL
    OR ledger_row.state IS DISTINCT FROM 'source_blocked'
    OR ledger_row.reconciliation_code IS NULL
    OR ledger_row.reconciliation_code NOT IN ('provider_credentials_rejected','pre_dispatch_review_required')
    OR ledger_row.source_facts IS NULL OR ledger_row.source_frozen_at IS NULL
    OR ledger_row.dispatch_reserved_at IS NOT NULL OR ledger_row.provider_trx_record_id IS NOT NULL
    OR ledger_row.document_number IS NOT NULL OR ledger_row.document_url IS NOT NULL
    OR payment_row.provider IS DISTINCT FROM 'pelecard' OR payment_row.operation IS DISTINCT FROM 'payment'
    OR payment_row.status IS DISTINCT FROM 'succeeded'
    OR EXISTS (SELECT 1 FROM public.payment_transactions child
      WHERE child.parent_transaction_id = p_payment_id
        AND child.status IN ('refunded','voided','refund_pending','void_pending'))
    OR payment_row.created_at < control_row.activation_cutoff_utc
    OR payment_row.verified_at < control_row.activation_cutoff_utc
    OR payment_row.verified_at IS NULL OR payment_row.verified_at < payment_row.created_at
    OR ledger_row.sale_id IS DISTINCT FROM payment_row.sale_id
    OR ledger_row.order_id IS DISTINCT FROM payment_row.order_id
    OR ledger_row.source_facts->>'paymentId' IS DISTINCT FROM p_payment_id::text
    OR ledger_row.source_facts->>'pelecardTransactionId' IS DISTINCT FROM payment_row.provider_transaction_id
    OR (ledger_row.source_facts->>'amount')::numeric IS DISTINCT FROM payment_row.amount
    OR billing_row.payment_id IS NULL OR billing_row.order_id IS DISTINCT FROM payment_row.order_id
    OR billing_row.customer_kind NOT IN ('person','organization') OR billing_row.customer_kind IS NULL
    OR billing_row.billing_name IS NULL OR btrim(billing_row.billing_name) = ''
    OR billing_row.billing_identity IS NULL OR billing_row.billing_identity !~ '^[0-9]{9}$'
    OR (billing_row.customer_kind = 'person' AND NOT public.payper_valid_person_identity(billing_row.billing_identity))
    OR billing_row.billing_email IS NULL
    OR billing_row.billing_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR billing_row.vat_applicable IS NULL
  THEN RAISE EXCEPTION 'payper_recovery_fence' USING ERRCODE = '42501'; END IF;
  IF ledger_row.reconciliation_evidence IS NULL
    OR ledger_row.reconciliation_evidence ? 'rearmedAt'
    OR ledger_row.reconciliation_evidence->>'reference' IS DISTINCT FROM p_expected_trx_record_id
    OR ledger_row.reconciliation_evidence->>'actorId' IS DISTINCT FROM p_actor_id::text
    OR EXISTS (SELECT 1 FROM public.payper_document_ledger other
      WHERE other.payment_id <> p_payment_id
        AND other.provider_trx_record_id = p_expected_trx_record_id)
    OR EXISTS (SELECT 1 FROM public.accounting_documents d WHERE
      (d.source_type = 'payment_transaction' AND d.source_id = p_payment_id::text)
      OR (d.source_type = 'order' AND d.source_id = ledger_row.order_id::text)
      OR (d.source_type = 'sale' AND d.source_id = ledger_row.sale_id::text))
    OR EXISTS (SELECT 1 FROM public.immediate_accounting_preparations a
      WHERE a.payment_id = p_payment_id AND a.dispatch_started_at IS NOT NULL)
  THEN RAISE EXCEPTION 'payper_reconciliation_evidence_required' USING ERRCODE = '42501'; END IF;
  UPDATE public.payper_document_ledger SET state = 'source_frozen',
    reconciliation_code = NULL,
    reconciliation_evidence = ledger_row.reconciliation_evidence ||
      jsonb_build_object('previousCode', ledger_row.reconciliation_code,
        'rearmedAt', clock_timestamp()),
    updated_at = clock_timestamp()
  WHERE id = ledger_row.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.rearm_payper_source_after_reconciliation(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rearm_payper_source_after_reconciliation(uuid,uuid,text)
  TO service_role;

COMMIT;
