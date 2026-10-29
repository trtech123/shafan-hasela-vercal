import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const migration = readFileSync(fileURLToPath(new URL(
  "../../../migrations/202610220003_payper_disabled_ledger.sql", import.meta.url,
)), "utf8");

describe("Payper disabled ledger migration", () => {
  test("keeps dispatch impossible under the installed constraint and switch", () => {
    expect(migration).toContain("enabled=false");
    expect(migration).toContain("VALUES(true,false,NULL)");
    expect(migration).toContain("payper_dispatch_disabled");
    expect(migration).toContain("dispatch_remaining integer NOT NULL DEFAULT 0");
    expect(migration).toContain("l.state<>'source_frozen'");
  });

  test("stores a nullable UTC activation instant and gates historical attempts at capture, freeze, and reserve", () => {
    expect(migration).toContain("activation_cutoff_utc timestamptz");
    expect(migration).toContain("NEW.created_at>=cutoff AND NEW.verified_at>=cutoff");
    expect(migration).toContain("p.created_at<cutoff OR p.verified_at<cutoff");
    expect(migration).not.toContain("WHERE accounting_provider='rivhit' AND purpose='payment_success'\n AND source_type='payment_transaction' AND status IN ('pending','retryable_error')");
  });

  test("holds both legacy Pelecard Rivhit issuance paths", () => {
    expect(migration).toContain("trg_hold_rivhit_pelecard_issuance");
    expect(migration).toContain("trg_hold_pelecard_immediate_rivhit");
    expect(migration).toContain("trg_hold_rivhit_pelecard_document");
    expect(migration).toContain("ELSIF NEW.status='processing' THEN");
    expect(migration).not.toContain("OLD.status IS DISTINCT FROM 'processing'");
    expect(migration).toContain("NEW.dispatch_started_at IS NOT NULL");
    expect(migration).toContain("p.created_at>=cutoff");
  });

  test("deduplicates eligibility and forbids re-dispatch after uncertainty", () => {
    expect(migration).toContain("payment_id uuid NOT NULL UNIQUE");
    expect(migration).toContain("payper_document_ledger_order_unique");
    expect(migration).toContain("ON CONFLICT DO NOTHING");
    expect(migration).toContain("l.state<>'dispatch_reserved'");
    expect(migration).toContain("state='reconciliation_required'");
    expect(migration).toContain("reconciliation_evidence IS NULL");
    expect(migration).toContain("source_blocked");
    expect(migration).toContain("hold_payper_source");
  });

  test("limits RPC use to service role and manual evidence to an administrator", () => {
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.freeze_payper_source(uuid) TO service_role");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.reserve_payper_dispatch(uuid) TO service_role");
    expect(migration).toContain("role::text='admin'");
  });
});
