import { describe, expect, test, vi } from "vitest";
import { createDisabledPayperLedger, createPayperLedger } from "./ledger.ts";

describe("disabled Payper ledger application gate", () => {
  test("persists only classified document identity after a reserved dispatch", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "succeeded", error: null });
    const ledger = createDisabledPayperLedger({ rpc });
    await ledger.recordOutcome("payment-1", { state: "succeeded", documentNumber: "595170",
      documentUrl: "https://app.payper.co.il/public/invoice_show/595170?ak=opaque", automaticRetryAllowed: false });
    expect(rpc).toHaveBeenCalledWith("record_payper_dispatch_outcome_v2", {
      p_payment_id: "payment-1", p_state: "succeeded", p_document_number: "595170",
      p_document_url: "https://app.payper.co.il/public/invoice_show/595170?ak=opaque", p_code: null,
      p_response_received: false, p_provider_status_code: null, p_invoice_status: null, p_invoice_error: null,
    });
  });
  test("freezes a verified payment through the atomic database RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { paymentId: "payment-1" }, error: null });
    const ledger = createDisabledPayperLedger({ rpc });
    expect(await ledger.freezeSource("payment-1")).toEqual({ paymentId: "payment-1" });
    expect(rpc).toHaveBeenCalledWith("freeze_payper_source", { p_payment_id: "payment-1" });
  });

  test("never reserves a dispatch even when called repeatedly or concurrently", async () => {
    const rpc = vi.fn();
    const ledger = createDisabledPayperLedger({ rpc });
    const outcomes = await Promise.allSettled([ledger.reserveDispatch("payment-1"), ledger.reserveDispatch("payment-1")]);
    expect(outcomes.map((item) => item.status)).toEqual(["rejected", "rejected"]);
    expect(rpc).not.toHaveBeenCalled();
  });

  test("records only a safe classification, never raw provider response", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "reconciliation_required", error: null });
    const ledger = createDisabledPayperLedger({ rpc });
    await ledger.recordDispatchedOutcome("payment-1", { kind: "transport_error" });
    expect(rpc).toHaveBeenCalledWith("record_payper_dispatch_outcome_v2", {
      p_payment_id: "payment-1", p_state: "reconciliation_required",
      p_document_number: null, p_document_url: null, p_code: "uncertain_provider_outcome",
      p_response_received: false, p_provider_status_code: null, p_invoice_status: null, p_invoice_error: null,
    });
  });

  test("stores a confirmed document identity only for documented success", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "succeeded", error: null });
    const ledger = createDisabledPayperLedger({ rpc });
    await ledger.recordDispatchedOutcome("payment-1", { kind: "response", body: {
      StatusCode: "000", PayperData: { InvoiceStatus: "Success", InvoiceNumber: "42",
        InvoiceLink: "https://app.payper.co.il/public/invoice_show/42?ak=opaque" },
    } });
    expect(rpc).toHaveBeenCalledWith("record_payper_dispatch_outcome_v2", {
      p_payment_id: "payment-1", p_state: "succeeded", p_document_number: "42",
      p_document_url: "https://app.payper.co.il/public/invoice_show/42?ak=opaque", p_code: null,
      p_response_received: false, p_provider_status_code: null, p_invoice_status: null, p_invoice_error: null,
    });
  });

  test("passes exact provider status and error only to the restricted outcome RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "reconciliation_required", error: null });
    await createPayperLedger({ rpc }, true).recordOutcome("payment-1", {
      state: "reconciliation_required", automaticRetryAllowed: false, safeCode: "provider_document_rejected",
      responseReceived: true, providerStatusCode: "000", invoiceStatus: "Error", invoiceError: "catalog_id must be numeric",
    });
    expect(rpc).toHaveBeenCalledWith("record_payper_dispatch_outcome_v2", expect.objectContaining({
      p_response_received: true, p_provider_status_code: "000", p_invoice_status: "Error",
      p_invoice_error: "catalog_id must be numeric",
    }));
  });

  test("redacts backend errors", async () => {
    const ledger = createDisabledPayperLedger({ rpc: vi.fn().mockResolvedValue({ error: { message: "secret-token" } }) });
    await expect(ledger.freezeSource("payment-1")).rejects.toThrow("payper_freeze_source_failed");
  });
  test("records a safe pre-dispatch reason without raw provider text", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await createDisabledPayperLedger({ rpc }).holdFailure("payment-1", "provider_credentials_rejected");
    expect(rpc).toHaveBeenCalledWith("hold_payper_source", {
      p_payment_id: "payment-1", p_code: "provider_credentials_rejected",
    });
  });
  test("preserves only the safe quota code so valid payments stay eligible", async () => {
    const ledger = createPayperLedger({ rpc: vi.fn().mockResolvedValue({ error: { message: "payper_dispatch_limit_reached" } }) }, true);
    await expect(ledger.reserveDispatch("payment-1", "103059585")).rejects.toThrow("payper_dispatch_limit_reached");
  });
  test("reserves with the verified transaction record, never the hosted session ID alone", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "reservation-1", error: null });
    const ledger = createPayperLedger({ rpc }, true);
    await expect(ledger.reserveDispatch("payment-1", "103059585")).resolves.toBe("reservation-1");
    expect(rpc).toHaveBeenCalledWith("reserve_payper_dispatch", {
      p_payment_id: "payment-1", p_trx_record_id: "103059585",
    });
    await expect(ledger.reserveDispatch("payment-1", "hosted-session-123"))
      .rejects.toThrow("payper_transaction_record_required");
  });
});
