import { describe, expect, test, vi } from "vitest";
import { createPayperIssuanceRuntime } from "./runtime.ts";

describe("server-only Payper runtime", () => {
  test("missing gateway credentials fail before touching the ledger or network", async () => {
    const rpc = vi.fn(); const fetcher = vi.fn();
    const runtime = createPayperIssuanceRuntime({ serviceClient: { rpc }, env: {}, fetcher });
    await expect(runtime.issue("payment-1")).rejects.toThrow("payper_credentials_required");
    expect(rpc).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("configured runtime still has no document dispatch route", async () => {
    const rpc = vi.fn(async (name: string) => name === "freeze_payper_source"
      ? { data: { paymentId: "payment-1", pelecardTransactionId: "hosted-1", amount: 100, currency: "ILS",
        paymentCreatedAt: "2026-11-01T10:00:00Z", verifiedAt: "2026-11-01T10:00:01Z",
        activationCutoffUtc: "2026-11-01T10:00:00Z",
        orderId: "order-1", orderNumber: "ORD-1", customerKind: "person",
        billing: { vat_applicable: true, client_name: "Test", client_email: "test@example.org", billing_company_id: "000000018" },
        checkoutSnapshot: { items: [{ id: "item", name: "Test", qty: 1, customPrice: 100 }], discount: null } }, error: null }
      : { data: null, error: { message: "must not be called" } });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ StatusCode: "000", ResultData: {
      TransactionId: "hosted-1", TransactionPelecardId: 12345, ShvaResult: "000", DebitTotal: "10000", DebitCurrency: "1",
    } }), { status: 200 }));
    const runtime = createPayperIssuanceRuntime({ serviceClient: { rpc }, fetcher, env: {
      PELECARD_TERMINAL: "1234567", PELECARD_USER: "user", PELECARD_PASSWORD: "secret",
    } });
    await expect(runtime.issue("payment-1")).rejects.toThrow("payper_dispatch_disabled");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["freeze_payper_source"]);
  });

  test("explicit runtime gate uses the one-shot reservation before document POST", async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async (name: string) => {
      calls.push(name);
      if (name === "freeze_payper_source") return { data: {
        paymentId: "payment-1", pelecardTransactionId: "hosted-1", amount: 100, currency: "ILS",
        paymentCreatedAt: "2026-11-01T10:00:00Z", verifiedAt: "2026-11-01T10:00:01Z",
        activationCutoffUtc: "2026-11-01T10:00:00Z", orderId: "order-1", orderNumber: "ORD-1",
        customerKind: "person", billing: { vat_applicable: true, client_name: "Test", client_email: "test@example.org", billing_company_id: "000000018" },
        checkoutSnapshot: { items: [{ id: "item", name: "Test", qty: 1, customPrice: 100 }], discount: null },
      }, error: null };
      if (name === "reserve_payper_dispatch") return { data: "reservation-1", error: null };
      return { data: "succeeded", error: null };
    });
    const fetcher = vi.fn(async (url: string) => {
      calls.push(url.includes("CreatePayperInvoice") ? "document_post" : "transaction_lookup");
      return new Response(JSON.stringify(url.includes("CreatePayperInvoice")
        ? { StatusCode: "000", PayperData: { InvoiceStatus: "Success", InvoiceNumber: "42", InvoiceLink: "https://app.payper.co.il/public/invoice_show/42" } }
        : { StatusCode: "000", ResultData: { TransactionId: "hosted-1", TransactionPelecardId: 12345, ShvaResult: "000", DebitTotal: "10000", DebitCurrency: "1" } }));
    });
    const runtime = createPayperIssuanceRuntime({ serviceClient: { rpc }, fetcher: fetcher as typeof fetch,
      env: { PELECARD_TERMINAL: "1234567", PELECARD_USER: "user", PELECARD_PASSWORD: "secret", PAYPER_DISPATCH_ENABLED: "true" } });
    expect((await runtime.issue("payment-1")).state).toBe("succeeded");
    expect(calls).toEqual(["freeze_payper_source", "transaction_lookup", "reserve_payper_dispatch", "document_post", "record_payper_dispatch_outcome"]);
  });
});
