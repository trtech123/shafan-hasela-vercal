import { describe, expect, test } from "vitest";
import { classifyDispatchedPayperOutcome } from "./outcome.ts";

describe("Payper post-dispatch outcome", () => {
  test("accepts only both documented success statuses and a document identity", () => {
    expect(classifyDispatchedPayperOutcome({
      kind: "response",
      body: {
        StatusCode: "000",
        PayperData: {
          InvoiceStatus: "Success",
          InvoiceNumber: "595166",
          InvoiceLink: "https://app.payper.co.il/public/invoice_show/595166?ak=opaque",
        },
      },
    })).toEqual({
      state: "succeeded", documentNumber: "595166",
      documentUrl: "https://app.payper.co.il/public/invoice_show/595166?ak=opaque",
      automaticRetryAllowed: false,
    });
  });

  test.each([
    { StatusCode: "000", PayperData: { InvoiceStatus: "", InvoiceNumber: "", InvoiceLink: "" } },
    { StatusCode: "000", PayperData: { InvoiceStatus: "Success", InvoiceNumber: "", InvoiceLink: "" } },
    { StatusCode: "111", PayperData: { InvoiceStatus: "Error", InvoiceError: "unknown IP" } },
    { StatusCode: "000", PayperData: { InvoiceStatus: "Success", InvoiceNumber: "1", InvoiceLink: "http://example.test/doc" } },
    { StatusCode: "000", PayperData: { InvoiceStatus: "Success", InvoiceNumber: "1", InvoiceLink: "https://app.payper.co.il/public/invoice_show/2?ak=opaque" } },
    { StatusCode: "000", PayperData: { InvoiceStatus: "Success", InvoiceNumber: "1", InvoiceLink: "https://app.payper.co.il/unrelated/1" } },
    null,
  ])("requires reconciliation after a dispatched ambiguous response", (body) => {
    expect(classifyDispatchedPayperOutcome({ kind: "response", body })).toEqual({
      state: "reconciliation_required", automaticRetryAllowed: false,
    });
  });

  test("a timeout never authorizes another creation request", () => {
    expect(classifyDispatchedPayperOutcome({ kind: "transport_error" })).toEqual({
      state: "reconciliation_required", automaticRetryAllowed: false,
    });
  });
});
