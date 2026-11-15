import { describe, expect, it, vi } from "vitest";
import { buildNoncardPayperRequest, dispatchNoncardPayper, noncardCollectionAllowed, noncardCollectionEnabled } from "./noncard.ts";

const source = () => ({
  amountMinor: 11800, method: "check" as const, documentType: "invoice-receipt" as const,
  referenceDocumentId: null, receiptNumber: "RCP-2000",
  paidDate: "2026-11-15",
  items: [{ name: "Group climbing", qty: 1, customPrice: 118 }],
  billing: { kind: "person", name: "Test Customer", identity: "123456782", email: "test@example.com" },
  vatApplicable: true,
  check: { check_number: "0042", bank: "Bank", branch: "012", account_number: "000123",
    account_holder: "Test Customer", amount: "118", received_date: "2026-11-15", due_date: "2026-12-15" },
});
const auth = { terminalNumber: "123", user: "user", password: "secret" };

describe("non-card Payper check documents", () => {
  it("restricts live test collection to the selected cashier when configured", () => {
    const actor = "11111111-1111-4111-8111-111111111111";
    const flags = new Map([["PAYPER_NONCARD_COLLECTION_ENABLED", "true"],
      ["PAYPER_CASH_DISPATCH_ENABLED", "true"], ["PAYPER_NONCARD_TEST_ACTOR_ID", actor]]);
    const env = (name: string) => flags.get(name);
    expect(noncardCollectionAllowed("cash", actor, env)).toBe(true);
    expect(noncardCollectionAllowed("cash", "22222222-2222-4222-8222-222222222222", env)).toBe(false);
    flags.set("PAYPER_NONCARD_TEST_ACTOR_ID", "invalid");
    expect(noncardCollectionAllowed("cash", actor, env)).toBe(false);
    flags.delete("PAYPER_NONCARD_TEST_ACTOR_ID");
    expect(noncardCollectionAllowed("cash", actor, env)).toBe(true);
  });
  it("cannot record a cash or check payment while its document dispatch is off", () => {
    const flags = new Map([["PAYPER_NONCARD_COLLECTION_ENABLED", "true"],
      ["PAYPER_CASH_DISPATCH_ENABLED", "true"], ["PAYPER_CHECK_DISPATCH_ENABLED", "false"]]);
    const env = (name: string) => flags.get(name);
    expect(noncardCollectionEnabled("cash", env)).toBe(true);
    expect(noncardCollectionEnabled("check", env)).toBe(false);
    flags.set("PAYPER_CHECK_DISPATCH_ENABLED", "true");
    expect(noncardCollectionEnabled("check", env)).toBe(false);
    flags.set("PAYPER_CHECK_DETAILS_CONTRACT_CONFIRMED", "true");
    expect(noncardCollectionEnabled("check", env)).toBe(true);
    expect(noncardCollectionEnabled("cash", () => undefined)).toBe(false);
    flags.delete("PAYPER_NONCARD_COLLECTION_ENABLED");
    expect(noncardCollectionEnabled("cash", env)).toBe(false);
  });
  it("uses empty card identifiers, a check receipt line, and preserves postdated details", () => {
    const request = buildNoncardPayperRequest(source(), auth);
    expect(request.trxRecordId).toBe("");
    expect(request.Uid).toBe("");
    expect(request.PayperParameters.DataPayper.receipt_lines).toEqual([
      { payment_type: "Cheque", date: "15-11-2026", amount: "11800" },
    ]);
    expect(request.PayperParameters.DataPayper.document_remarks).toContain("0042");
    expect(request.PayperParameters.DataPayper.document_remarks).toContain("15-12-2026");
    expect(request.PayperParameters.DataPayper.send_by_mail).toBe("true");
    expect(request.PayperParameters.DataPayper.document_no_vat).toBe("false");
  });
  it("rejects an amount that differs from the server-frozen item sum", () => {
    expect(() => buildNoncardPayperRequest({ ...source(), amountMinor: 11799 }, auth))
      .toThrow("payper_amount_mismatch");
  });
  it("uses actual frozen item names for a discounted gross invoice line", () => {
    const request = buildNoncardPayperRequest({ ...source(), method: "cash", check: null,
      amountMinor: 10800, discount: { type: "synthetic" } }, auth);
    expect(request.PayperParameters.DataPayper.invoice_lines).toEqual([{
      description: "Group climbing", quantity: "1", price_per_unit: "10800", include_vat: "true",
    }]);
  });
  it("rejects an unsupported existing-invoice reference", () => {
    expect(() => buildNoncardPayperRequest({ ...source(),
      referenceDocumentId: "undocumented-provider-id" } as never, auth))
      .toThrow("payper_source_incomplete");
  });
  it("never retries an uncertain creation response", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network timeout"));
    const result = await dispatchNoncardPayper(buildNoncardPayperRequest(source(), auth), fetcher);
    expect(result).toMatchObject({ state: "reconciliation_required", automaticRetryAllowed: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("accepts only documented success evidence as an issued document", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      StatusCode: "000", PayperData: { InvoiceStatus: "Success", InvoiceNumber: "1500",
        InvoiceLink: "https://app.payper.co.il/public/invoice_show/1500" },
    }), { status: 200 }));
    const outcome = await dispatchNoncardPayper(buildNoncardPayperRequest(source(), auth), fetcher);
    expect(outcome).toMatchObject({ state: "succeeded", documentNumber: "1500",
      automaticRetryAllowed: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("holds a Payper rejection for reconciliation", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      StatusCode: "145", PayperData: { InvoiceStatus: "Error" },
    }), { status: 200 }));
    expect(await dispatchNoncardPayper(buildNoncardPayperRequest(source(), auth), fetcher))
      .toMatchObject({ state: "reconciliation_required", automaticRetryAllowed: false });
  });
  it("uses the documented cash receipt line for an order balance", () => {
    const request = buildNoncardPayperRequest({ ...source(), method: "cash", check: null }, auth);
    expect(request).toEqual({
      terminalNumber: "123", user: "user", password: "secret", trxRecordId: "", Uid: "",
      PayperParameters: { typeDocument: "Invoice-Receipt", DataPayper: {
        document_lang: "hb", customer_name: "Test Customer", customer_unique_id: "123456782",
        customer_mail: "test@example.com", send_by_mail: "true", document_subject: "RCP-2000",
        document_rounded: "false", document_no_vat: "false",
        invoice_lines: [{ description: "Group climbing", quantity: "1",
          price_per_unit: "11800", include_vat: "true" }],
        receipt_lines: [{ payment_type: "Cash", date: "15-11-2026", amount: "11800" }],
      } },
    });
    expect(request.PayperParameters.DataPayper.receipt_lines[0].payment_type).toBe("Cash");
    expect(request.PayperParameters.DataPayper).not.toHaveProperty("document_remarks");
    expect(request.PayperParameters.DataPayper.receipt_lines[0]).toEqual({
      payment_type: "Cash", date: "15-11-2026", amount: "11800",
    });
  });
  it("blocks issuance if the frozen VAT fact is absent or not true", () => {
    expect(() => buildNoncardPayperRequest({ ...source(), vatApplicable: undefined } as never, auth))
      .toThrow("payper_vat_review_required");
    expect(() => buildNoncardPayperRequest({ ...source(), vatApplicable: false }, auth))
      .toThrow("payper_vat_review_required");
  });
  it("rejects an invalid frozen person identity", () => {
    expect(() => buildNoncardPayperRequest({ ...source(), billing: {
      ...source().billing, identity: "123456789",
    } }, auth)).toThrow("payper_billing_incomplete");
  });
  it("rejects impossible cash and check calendar dates", () => {
    expect(() => buildNoncardPayperRequest({ ...source(), method: "cash", check: null,
      paidDate: "2026-02-30" }, auth)).toThrow("payper_check_date_invalid");
    expect(() => buildNoncardPayperRequest({ ...source(), check: {
      ...source().check, due_date: "2026-02-30",
    } }, auth)).toThrow("payper_check_date_invalid");
  });
});
