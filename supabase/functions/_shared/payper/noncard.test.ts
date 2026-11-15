import { describe, expect, it, vi } from "vitest";
import { buildNoncardPayperRequest, dispatchNoncardPayper } from "./noncard.ts";

const source = () => ({
  amountMinor: 11800, method: "check" as const, documentType: "invoice-receipt" as const,
  referenceDocumentId: null, receiptNumber: "RCP-2000",
  paidDate: "2026-11-15",
  items: [{ name: "Group climbing", qty: 1, customPrice: 118 }],
  billing: { name: "Test Customer", identity: "123456789", email: "test@example.com" },
  check: { check_number: "0042", bank: "Bank", branch: "012", account_number: "000123",
    account_holder: "Test Customer", amount: "118", received_date: "2026-11-15", due_date: "2026-12-15" },
});
const auth = { terminalNumber: "123", user: "user", password: "secret" };

describe("non-card Payper check documents", () => {
  it("uses empty card identifiers, a check receipt line, and preserves postdated details", () => {
    const request = buildNoncardPayperRequest(source(), auth);
    expect(request.trxRecordId).toBe("");
    expect(request.Uid).toBe("");
    expect(request.PayperParameters.DataPayper.receipt_lines).toEqual([
      { payment_type: "Check", date: "15-11-2026", amount: 11800 },
    ]);
    expect(request.PayperParameters.DataPayper.document_remarks).toContain("0042");
    expect(request.PayperParameters.DataPayper.document_remarks).toContain("15-12-2026");
    expect(request.PayperParameters.DataPayper.send_by_mail).toBe("true");
  });
  it("rejects an amount that differs from the server-frozen item sum", () => {
    expect(() => buildNoncardPayperRequest({ ...source(), amountMinor: 11799 }, auth))
      .toThrow("payper_amount_mismatch");
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
    expect(request.PayperParameters.DataPayper.receipt_lines[0].payment_type).toBe("Cash");
    expect(request.PayperParameters.DataPayper).not.toHaveProperty("document_remarks");
  });
});
