import { describe, expect, test, vi } from "vitest";
import { issueFrozenPayperDocument } from "./issuance.ts";
import type { FrozenPayperFacts } from "./provider.ts";

const source = (): FrozenPayperFacts => ({
  paymentId: "77777777-7777-4777-8777-777777777777", pelecardTransactionId: "hosted-session-123",
  paymentCreatedAt: "2026-11-01T10:00:00Z", verifiedAt: "2026-11-01T10:00:01Z",
  activationCutoffUtc: "2026-11-01T10:00:00Z",
  amount: 118, currency: "ILS", orderId: "44444444-4444-4444-8444-444444444444", orderNumber: "ORD-1",
  customerKind: "organization", billing: { vat_applicable: true, billing_institution_name: "Example Ltd", billing_company_id: "512783333" },
  checkoutSnapshot: { items: [{ id: "activity", name: "Climbing", qty: 1, customPrice: 118 }], discount: null },
});
const auth = { terminalNumber: "1234567", user: "gateway-user", password: "gateway-secret" };

describe("Payper ledger to provider issuance bridge", () => {
  test("old attempt with a delayed successful callback cannot reach provider lookup", async () => {
    const old = source(); old.paymentCreatedAt = "2026-11-01T09:59:59.999Z";
    const ledger = { freezeSource: vi.fn(async () => old), reserveDispatch: vi.fn(), recordOutcome: vi.fn() };
    const provider = { lookupTransaction: vi.fn(), createInvoice: vi.fn() };
    await expect(issueFrozenPayperDocument(old.paymentId, { ledger, provider, credentials: auth })).rejects.toThrow("payper_activation_fence");
    expect(provider.lookupTransaction).not.toHaveBeenCalled();
    expect(ledger.reserveDispatch).not.toHaveBeenCalled();
  });
  test("reserves once before creation and records the documented identity", async () => {
    const calls: string[] = [];
    const ledger = {
      freezeSource: vi.fn(async () => { calls.push("freeze"); return source(); }),
      reserveDispatch: vi.fn(async () => { calls.push("reserve"); return "reservation-1"; }),
      recordOutcome: vi.fn(async () => { calls.push("record"); }),
    };
    const provider = {
      lookupTransaction: vi.fn(async () => { calls.push("lookup"); return "103059585"; }),
      createInvoice: vi.fn(async () => { calls.push("create"); return { state: "succeeded" as const,
        documentNumber: "595170", documentUrl: "https://app.payper.co.il/public/invoice_show/595170?ak=opaque", automaticRetryAllowed: false as const }; }),
    };
    const outcome = await issueFrozenPayperDocument(source().paymentId, { ledger, provider, credentials: auth });
    expect(calls).toEqual(["freeze", "lookup", "reserve", "create", "record"]);
    expect(provider.lookupTransaction).toHaveBeenCalledWith("hosted-session-123", 11800);
    expect(provider.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ trxRecordId: "103059585" }), "reservation-1");
    expect(ledger.recordOutcome).toHaveBeenCalledWith(source().paymentId, outcome);
  });

  test("duplicate or existing-document reservation failure prevents a provider request", async () => {
    const provider = { lookupTransaction: vi.fn(async () => "103059585"), createInvoice: vi.fn() };
    const ledger = { freezeSource: vi.fn(async () => source()),
      reserveDispatch: vi.fn(async () => { throw new Error("existing_accounting_document_or_dispatch"); }),
      recordOutcome: vi.fn() };
    await expect(issueFrozenPayperDocument(source().paymentId, { ledger, provider, credentials: auth })).rejects.toThrow("existing_accounting_document_or_dispatch");
    expect(provider.createInvoice).not.toHaveBeenCalled();
  });

  test("two concurrent callers share one durable reservation and only one sends", async () => {
    let reserved = false;
    const ledger = { freezeSource: vi.fn(async () => source()),
      reserveDispatch: vi.fn(async () => { if (reserved) throw new Error("payper_dispatch_fence"); reserved = true; return "reservation-1"; }),
      recordOutcome: vi.fn(async () => undefined) };
    const provider = { lookupTransaction: vi.fn(async () => "103059585"), createInvoice: vi.fn(async () => ({
      state: "reconciliation_required" as const, automaticRetryAllowed: false as const,
    })) };
    const results = await Promise.allSettled([1, 2].map(() => issueFrozenPayperDocument(source().paymentId, { ledger, provider, credentials: auth })));
    expect(results.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(provider.createInvoice).toHaveBeenCalledTimes(1);
  });

  test("disabled ledger prevents dispatch even when a provider is supplied", async () => {
    const provider = { lookupTransaction: vi.fn(async () => "103059585"), createInvoice: vi.fn() };
    const ledger = { freezeSource: vi.fn(async () => source()), reserveDispatch: vi.fn(async () => { throw new Error("payper_dispatch_disabled"); }), recordOutcome: vi.fn() };
    await expect(issueFrozenPayperDocument(source().paymentId, { ledger, provider, credentials: auth })).rejects.toThrow("payper_dispatch_disabled");
    expect(provider.createInvoice).not.toHaveBeenCalled();
  });
});
