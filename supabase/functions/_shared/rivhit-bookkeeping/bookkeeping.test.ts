import { describe, expect, test, vi } from "vitest";
import { createJournalSource } from "./source.ts";
import { readJournalConfiguration } from "./config.ts";
import { createJournalClient, JournalOutcomeUnknown } from "./client.ts";
import { processJournalLeg } from "./worker.ts";
import { createJournalRepository } from "./repository.ts";
import { createRequestReference } from "./identity.ts";

const source = {
  accountNamespace: "test-account", sourceSystem: "payper" as const,
  sourceDocumentId: "invoice-200002", documentNumber: "200002",
  paymentId: "PRODUCTION_PAYMENT_ID_REDACTED",
  saleId: "11111111-1111-4111-8111-111111111111",
  documentType: "invoice_receipt", issuedAt: "2026-11-08T02:41:00Z",
  grossMinor: 400, currency: "ILS",
};

describe("Rivhit bookkeeping source", () => {
  test("keeps provider document and payment identities without assigning accounts", () => {
    const result = createJournalSource(source);
    expect(result).toMatchObject(source);
    expect(result.identityKey).toBe("test-account:payper:invoice-200002");
    expect(Object.keys(result)).not.toContain("incomeAccount");
  });

  test("rejects missing document identity and nonpositive money", () => {
    expect(() => createJournalSource({ ...source, sourceDocumentId: "" })).toThrow();
    expect(() => createJournalSource({ ...source, grossMinor: 0 })).toThrow();
  });
});

test("request reference is deterministic per source, leg and correction", async () => {
  const first = await createRequestReference("account", "payper-id", "invoice", 0);
  expect(first).toBe(await createRequestReference("account", "payper-id", "invoice", 0));
  expect(first).not.toBe(await createRequestReference("account", "payper-id", "receipt", 0));
  expect(first).not.toContain("payper-id");
});

describe("journal activation", () => {
  test("is disabled when flag or approved mapping is missing", () => {
    expect(readJournalConfiguration({})).toMatchObject({ enabled: false, mapping: null });
    expect(readJournalConfiguration({ RIVHIT_JOURNAL_ENABLED: "true" }))
      .toMatchObject({ enabled: false, mapping: null });
    expect(readJournalConfiguration({
      RIVHIT_JOURNAL_ENABLED: "true",
      RIVHIT_JOURNAL_MAPPING_JSON: JSON.stringify({ approved: false, version: "v1" }),
    })).toMatchObject({ enabled: false, mapping: null });
  });

  test("accepts only an explicit approved, complete mapping revision", () => {
    const mapping = { approved: true, approvalRef: "accountant-approval", version: "v1",
      accountNamespace: "test-account", legs: [
        { kind: "invoice", sortCode: 101, debitAccount: 201, creditAccount: 301, currencyId: 1 },
      ] };
    expect(readJournalConfiguration({ RIVHIT_JOURNAL_ENABLED: "true",
      RIVHIT_JOURNAL_MAPPING_JSON: JSON.stringify(mapping) }))
      .toEqual({ enabled: true, mapping });
    expect(readJournalConfiguration({ RIVHIT_JOURNAL_ENABLED: "true",
      RIVHIT_JOURNAL_MAPPING_JSON: JSON.stringify({ ...mapping, approvalRef: "" }) }).enabled)
      .toBe(false);
  });
});

describe("Accounting.AddJournal adapter", () => {
  const request = { year: 2026, month: 11, sort_code: 101,
    customer_id_debit: 201, customer_id_credit: 301, reference_date: "08/11/2026",
    amount: 4, reference1: "200002", reference2: source.paymentId,
    currency_id: 1, request_reference: "sync:invoice-200002:invoice" };

  test("never calls Rivhit while disabled", async () => {
    const fetchImpl = vi.fn();
    const client = createJournalClient({ apiToken: "private", enabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.addJournal(request)).rejects.toThrow("journal_dispatch_disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("uses only AddJournal and returns its journal identity", async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      expect(body).toMatchObject({ ...request, api_token: "private" });
      expect(body).not.toHaveProperty("document_type");
      return new Response(JSON.stringify({ error_code: 0,
        data: { year: 2026, month: 11, line: 42 } }), { status: 200 });
    });
    const client = createJournalClient({ apiToken: "private", enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.addJournal(request)).resolves.toEqual({ year: 2026, month: 11, line: 42 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/Accounting.AddJournal");
  });

  test("does not let request fields replace the server token", async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      expect(JSON.parse(options.body).api_token).toBe("private");
      return new Response(JSON.stringify({ error_code: 0,
        data: { year: 2026, month: 11, line: 43 } }), { status: 200 });
    });
    const client = createJournalClient({ apiToken: "private", enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.addJournal({ ...request, api_token: "attacker" } as typeof request);
  });

  test("treats provider rejection as requiring reconciliation", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error_code: -107, client_message: "private" }), { status: 500 }));
    const client = createJournalClient({ apiToken: "private", enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.addJournal(request)).rejects.toBeInstanceOf(JournalOutcomeUnknown);
  });

  test("treats transport failure and malformed result as uncertain without leaking token", async () => {
    for (const fetchImpl of [
      vi.fn(async () => { throw Error("private network error"); }),
      vi.fn(async () => new Response("bad", { status: 200 })),
    ]) {
      const client = createJournalClient({ apiToken: "private", enabled: true,
        fetchImpl: fetchImpl as unknown as typeof fetch });
      try {
        await client.addJournal(request);
        throw Error("expected_uncertain_outcome");
      } catch (error) {
        expect(error).toBeInstanceOf(JournalOutcomeUnknown);
        expect(String(error)).not.toContain("private");
      }
    }
  });
});

describe("journal worker", () => {
  test("does not claim an event when mapping is disabled", async () => {
    const repository = { claim: vi.fn(), complete: vi.fn(), fail: vi.fn() };
    const client = { addJournal: vi.fn() };
    expect(await processJournalLeg({ enabled: false, legId: "leg", repository, client }))
      .toEqual({ status: "configuration_required" });
    expect(repository.claim).not.toHaveBeenCalled();
    expect(client.addJournal).not.toHaveBeenCalled();
  });

  test("persists one success for one claimed frozen leg", async () => {
    const repository = { claim: vi.fn(async () => ({ id: "leg", token: "claim", request: { amount: 4 } })),
      complete: vi.fn(async () => undefined), fail: vi.fn() };
    const client = { addJournal: vi.fn(async () => ({ year: 2026, month: 11, line: 42 })) };
    expect(await processJournalLeg({ enabled: true, legId: "leg", repository, client }))
      .toEqual({ status: "succeeded" });
    expect(repository.complete).toHaveBeenCalledWith("leg", "claim", { year: 2026, month: 11, line: 42 });
    expect(client.addJournal).toHaveBeenCalledTimes(1);
  });

  test("holds an uncertain dispatch for reconciliation and never retries it", async () => {
    const repository = { claim: vi.fn(async () => ({ id: "leg", token: "claim", request: { amount: 4 } })),
      complete: vi.fn(), fail: vi.fn(async () => undefined) };
    const client = { addJournal: vi.fn(async () => { throw new JournalOutcomeUnknown(); }) };
    expect(await processJournalLeg({ enabled: true, legId: "leg", repository, client }))
      .toEqual({ status: "reconciliation_required" });
    expect(repository.fail).toHaveBeenCalledWith("leg", "claim");
    expect(client.addJournal).toHaveBeenCalledTimes(1);
  });

  test("holds a successful remote response when local completion fails", async () => {
    const repository = { claim: vi.fn(async () => ({ id: "leg", token: "claim", request: { amount: 4 } })),
      complete: vi.fn(async () => { throw Error("db_timeout"); }),
      fail: vi.fn(async () => undefined) };
    const client = { addJournal: vi.fn(async () => ({ year: 2026, month: 11, line: 42 })) };
    expect(await processJournalLeg({ enabled: true, legId: "leg", repository, client }))
      .toEqual({ status: "reconciliation_required" });
    expect(client.addJournal).toHaveBeenCalledTimes(1);
  });

  test("keeps first invoice leg succeeded when receipt outcome is uncertain", async () => {
    const states = new Map([["invoice", "ready"], ["receipt", "ready"]]);
    const repository = {
      claim: vi.fn(async (id: string) => states.get(id) === "ready"
        ? { id, token: `claim-${id}`, request: { amount: 4 } } : null),
      complete: vi.fn(async (id: string) => { states.set(id, "succeeded"); }),
      fail: vi.fn(async (id: string) => { states.set(id, "reconciliation_required"); }),
    };
    const client = { addJournal: vi.fn()
      .mockResolvedValueOnce({ year: 2026, month: 11, line: 42 })
      .mockRejectedValueOnce(new JournalOutcomeUnknown()) };
    expect(await processJournalLeg({ enabled: true, legId: "invoice", repository, client }))
      .toEqual({ status: "succeeded" });
    expect(await processJournalLeg({ enabled: true, legId: "receipt", repository, client }))
      .toEqual({ status: "reconciliation_required" });
    expect([...states]).toEqual([["invoice", "succeeded"],
      ["receipt", "reconciliation_required"]]);
    expect(client.addJournal).toHaveBeenCalledTimes(2);
  });
});

describe("journal repository", () => {
  test("claims a single frozen request with a fencing token", async () => {
    const rpc = vi.fn(async (name) => name === "claim_rivhit_bookkeeping_leg"
      ? { data: [{ leg_id: "leg", claim_token: "claim", frozen_request: { amount: 4 } }], error: null }
      : { data: true, error: null });
    const repository = createJournalRepository({ rpc }, { version: "v1",
      approvalRef: "approved", accountNamespace: "test-account" });
    expect(await repository.claim("leg")).toEqual({ id: "leg", token: "claim", request: { amount: 4 } });
    await repository.complete("leg", "claim", { year: 2026, month: 11, line: 42 });
    expect(rpc).toHaveBeenCalledWith("complete_rivhit_bookkeeping_leg",
      { p_id: "leg", p_claim_token: "claim", p_year: 2026, p_month: 11, p_line: 42 });
  });

  test("rejects a stale completion or hold rather than reporting success", async () => {
    const repository = createJournalRepository({ rpc: vi.fn(async () => ({ data: false, error: null })) },
      { version: "v1", approvalRef: "approved", accountNamespace: "test-account" });
    await expect(repository.complete("leg", "stale", { year: 2026, month: 11, line: 42 }))
      .rejects.toThrow("journal_state_conflict");
    await expect(repository.fail("leg", "stale")).rejects.toThrow("journal_state_conflict");
  });
});
