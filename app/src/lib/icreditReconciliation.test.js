import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(here, "../../../supabase/migrations/023_clubs_and_recurring_billing.sql"),
  "utf8",
);

function applyEvent(state, event) {
  if (state.digests.has(event.digest)) return state;
  state.digests.add(event.digest);

  const current = state.charges.get(event.chargeNumber);
  if (!current || current.status !== "succeeded") {
    state.charges.set(event.chargeNumber, {
      amount: event.amount,
      status: event.status,
      saleId: event.saleId,
    });
  }
  state.debt = [...state.charges.values()]
    .filter((charge) => charge.status === "failed")
    .reduce((sum, charge) => sum + charge.amount, 0);
  return state;
}

function emptyState() {
  return { digests: new Set(), charges: new Map(), debt: 0 };
}

describe("iCredit recurring reconciliation invariants", () => {
  test("duplicate delivery cannot duplicate a charge or debt", () => {
    const state = emptyState();
    const failure = {
      digest: "failure-1",
      chargeNumber: 1,
      amount: 245,
      status: "failed",
      saleId: "sale-1",
    };

    applyEvent(state, failure);
    applyEvent(state, failure);

    expect(state.charges.size).toBe(1);
    expect(state.debt).toBe(245);
    expect(migration).toMatch(/ON CONFLICT \(event_digest\) DO NOTHING/i);
    expect(migration).toMatch(/UNIQUE \(agreement_id, provider_charge_number\)/i);
  });

  test("success for the same charge resolves exactly that failed obligation", () => {
    const state = emptyState();
    applyEvent(state, { digest: "failure-2", chargeNumber: 2, amount: 245, status: "failed", saleId: "sale-2a" });
    applyEvent(state, { digest: "retry-2", chargeNumber: 2, amount: 245, status: "succeeded", saleId: "sale-2b" });

    expect(state.charges.size).toBe(1);
    expect(state.charges.get(2).status).toBe("succeeded");
    expect(state.debt).toBe(0);
    expect(migration).toMatch(/status = 'failed' AND EXCLUDED\.status = 'succeeded'/i);
  });

  test("success for a later month leaves an older failed month outstanding", () => {
    const state = emptyState();
    applyEvent(state, { digest: "failure-3", chargeNumber: 3, amount: 245, status: "failed", saleId: "sale-3" });
    applyEvent(state, { digest: "success-4", chargeNumber: 4, amount: 245, status: "succeeded", saleId: "sale-4" });

    expect(state.charges.size).toBe(2);
    expect(state.debt).toBe(245);
    expect(migration).toMatch(/SUM\(amount\)[\s\S]*status = 'failed'/i);
  });

  test("a late failure cannot regress an already successful charge", () => {
    const state = emptyState();
    applyEvent(state, { digest: "success-5", chargeNumber: 5, amount: 245, status: "succeeded", saleId: "sale-5a" });
    applyEvent(state, { digest: "late-failure-5", chargeNumber: 5, amount: 245, status: "failed", saleId: "sale-5b" });

    expect(state.charges.get(5).status).toBe("succeeded");
    expect(state.debt).toBe(0);
    expect(migration).toMatch(/WHEN public\.recurring_charges\.status = 'succeeded' THEN 'succeeded'/i);
  });
});
