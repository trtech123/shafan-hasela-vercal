import { describe, expect, test, vi } from "vitest";
import { RivhitError } from "../rivhit/client.ts";
import { processRivhitJournal } from "./processor.ts";

const draft = {
  sort_code: 1, customer_id_debit: 100, customer_id_credit: 200,
  amount: 4, reference_date: "08112026", reference1: "200002",
  reference2: "RCP-1026", request_reference: "shafan:payper:200002:1",
};
const row = {
  journal_id: 55, journal_year: 2026, journal_month: 11,
  debit_customer_id: 100, credit_customer_id: 200, sort_code: 1,
  reference1: "200002", reference2: "RCP-1026", reference_date: "08/11/2026",
  total_amount: 4, total_vat: 0.61, total_without_vat: 3.39,
};

function fixture() {
  const store = {
    claim: vi.fn().mockResolvedValue({ id: "event-1", draft, expectedVat: 0.61 }),
    reserve: vi.fn().mockResolvedValue(true),
    recordResponse: vi.fn().mockResolvedValue(undefined),
    verify: vi.fn().mockResolvedValue(undefined),
    hold: vi.fn().mockResolvedValue(undefined),
  };
  const provider = {
    journalsReport: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([row]),
    addJournal: vi.fn().mockResolvedValue({ year: 2026, month: 11, line: 42 }),
  };
  return { store, provider };
}

describe("Rivhit journal dispatch", () => {
  test("duplicate worker delivery does not call Rivhit", async () => {
    const { store, provider } = fixture();
    store.claim.mockResolvedValue(null);
    await expect(processRivhitJournal("event-1", { store, provider })).resolves.toBe("already_claimed");
    expect(provider.addJournal).not.toHaveBeenCalled();
    expect(provider.journalsReport).not.toHaveBeenCalled();
  });

  test("a competing worker that reserved first prevents this delivery from posting", async () => {
    const { store, provider } = fixture();
    store.reserve.mockResolvedValue(false);
    await expect(processRivhitJournal("event-1", { store, provider })).resolves.toBe("already_claimed");
    expect(provider.addJournal).not.toHaveBeenCalled();
  });

  test("reserves durably before one provider call, then verifies exact evidence", async () => {
    const { store, provider } = fixture();
    await expect(processRivhitJournal("event-1", { store, provider })).resolves.toBe("verified");
    expect(store.reserve).toHaveBeenCalledOnce();
    expect(provider.addJournal).toHaveBeenCalledOnce();
    expect(store.reserve.mock.invocationCallOrder[0]).toBeLessThan(provider.addJournal.mock.invocationCallOrder[0]);
    expect(store.recordResponse).toHaveBeenCalledWith("event-1", { year: 2026, month: 11, line: 42 });
    expect(store.verify).toHaveBeenCalledWith("event-1", row);
  });

  test("an existing matching manual journal prevents a second post", async () => {
    const { store, provider } = fixture();
    provider.journalsReport.mockReset().mockResolvedValue([row]);
    await expect(processRivhitJournal("event-1", { store, provider })).resolves.toBe("existing_match");
    expect(store.hold).toHaveBeenCalledWith("event-1", "manual_existing_match");
    expect(store.reserve).not.toHaveBeenCalled();
    expect(provider.addJournal).not.toHaveBeenCalled();
  });

  test("a malformed report date cannot verify a journal", async () => {
    const { store, provider } = fixture();
    provider.journalsReport.mockReset().mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...row, reference_date: '31/02/2026' }]);
    await expect(processRivhitJournal("event-1", { store, provider }))
      .resolves.toBe("reconciliation_required");
    expect(store.verify).not.toHaveBeenCalled();
  });

  test("an interrupted response is held without retrying or claiming success", async () => {
    const { store, provider } = fixture();
    provider.addJournal.mockRejectedValue(new RivhitError("timeout", { reconciliationRequired: true }));
    await expect(processRivhitJournal("event-1", { store, provider })).resolves.toBe("uncertain");
    expect(provider.addJournal).toHaveBeenCalledOnce();
    expect(store.hold).toHaveBeenCalledWith("event-1", "provider_outcome_uncertain");
    expect(store.verify).not.toHaveBeenCalled();
  });

  test("a conflicting journal report blocks the post before dispatch", async () => {
    const { store, provider } = fixture();
    provider.journalsReport.mockReset().mockResolvedValue([{ ...row, total_amount: 5 }]);
    await expect(processRivhitJournal("event-1", { store, provider })).resolves.toBe("reconciliation_required");
    expect(store.hold).toHaveBeenCalledWith("event-1", "existing_reference_conflict");
    expect(provider.addJournal).not.toHaveBeenCalled();
  });

  test("a failed provider response cannot be dispatched again by duplicate delivery", async () => {
    const { store, provider } = fixture();
    provider.addJournal.mockRejectedValueOnce(new Error("connection lost after submit"));
    await expect(processRivhitJournal("event-1", { store, provider })).resolves.toBe("uncertain");
    store.claim.mockResolvedValueOnce(null);
    await expect(processRivhitJournal("event-1", { store, provider })).resolves.toBe("already_claimed");
    expect(provider.addJournal).toHaveBeenCalledTimes(1);
    expect(store.hold).toHaveBeenCalledWith("event-1", "provider_outcome_uncertain");
  });

  test("an unavailable preflight report blocks dispatch without reserving", async () => {
    const { store, provider } = fixture();
    provider.journalsReport.mockReset().mockRejectedValueOnce(new Error("unavailable"));
    await expect(processRivhitJournal("event-1", { store, provider })).resolves.toBe("reconciliation_required");
    expect(store.reserve).not.toHaveBeenCalled();
    expect(provider.addJournal).not.toHaveBeenCalled();
  });
});
