import { describe, expect, test, vi } from "vitest";
import { buildCreatePayperInvoice, createPelecardPayperProvider, decodeTransactionRecord } from "./provider.ts";

const facts = () => ({
  paymentId: "77777777-7777-4777-8777-777777777777",
  paymentCreatedAt: "2026-11-01T10:00:00Z", verifiedAt: "2026-11-01T10:00:01Z",
  activationCutoffUtc: "2026-11-01T10:00:00Z",
  pelecardTransactionId: "hosted-session-123",
  amount: 118,
  currency: "ILS",
  orderId: "44444444-4444-4444-8444-444444444444",
  orderNumber: "ORD-1",
  checkoutSnapshot: { items: [{ id: "activity", name: "Climbing", qty: 1, customPrice: 118 }], discount: null },
  billing: { vat_applicable: true, billing_institution_name: "Example Ltd", billing_company_id: "512783333", billing_accounting_email: "billing@example.test" },
  customerKind: "organization",
});
const gateway = () => ({ terminalNumber: "1234567", user: "gateway-user", password: "gateway-secret" });

describe("documented Pelecard Payper contract", () => {
  test("maps hosted TransactionId only after matching a read-only transaction lookup", () => {
    const id = decodeTransactionRecord({ StatusCode: "000", ResultData: {
      TransactionId: "hosted-session-123", TransactionPelecardId: 103059585,
      ShvaResult: "000", DebitTotal: "11800", DebitCurrency: "1",
    } }, "hosted-session-123", 11800);
    expect(id).toBe("103059585");
    expect(() => decodeTransactionRecord({ StatusCode: "000", ResultData: {
      TransactionId: "other", TransactionPelecardId: 103059585,
      ShvaResult: "000", DebitTotal: "11800", DebitCurrency: "1",
    } }, "hosted-session-123", 11800)).toThrow("payper_transaction_mismatch");
  });

  test("builds the documented transaction-linked invoice-receipt without card receipt lines", () => {
    expect(buildCreatePayperInvoice(facts(), "103059585", gateway())).toEqual({
      terminalNumber: "1234567", user: "gateway-user", password: "gateway-secret",
      trxRecordId: "103059585", Uid: "", PayperParameters: {
        typeDocument: "Invoice-Receipt", DataPayper: {
          document_lang: "hb", customer_unique_id: "512783333",
          customer_mail: "billing@example.test", customer_name: "Example Ltd",
          document_subject: "ORD-1", document_no_vat: "false", document_rounded: "false",
          invoice_lines: [{ description: "Climbing", quantity: "1", price_per_unit: "11800", include_vat: "true", catalog_id: "activity" }],
        },
      },
    });
  });

  test("maps exempt billing facts and rejects unknown tax treatment, discounts, and mismatched totals", () => {
    const exempt = facts(); exempt.billing.vat_applicable = false;
    expect(buildCreatePayperInvoice(exempt, "103059585", gateway()).PayperParameters.DataPayper).toMatchObject({
      document_no_vat: "true", invoice_lines: [{ price_per_unit: "11800", include_vat: "false", no_vat: "true" }],
    });
    const unknown = facts(); delete unknown.billing.vat_applicable;
    expect(() => buildCreatePayperInvoice(unknown, "103059585", gateway())).toThrow("payper_vat_contract_mismatch");
    const discounted = facts(); discounted.checkoutSnapshot.discount = { mode: "fixed" } as never;
    expect(() => buildCreatePayperInvoice(discounted, "103059585", gateway())).toThrow("payper_discount_mapping_required");
    const mismatch = facts(); mismatch.amount = 117;
    expect(() => buildCreatePayperInvoice(mismatch, "103059585", gateway())).toThrow("payper_amount_mismatch");
  });

  test("requires an actual customer identity for people as well as organizations", () => {
    const person = facts();
    person.customerKind = "person";
    person.billing.billing_company_id = "";
    expect(() => buildCreatePayperInvoice(person, "103059585", gateway())).toThrow("payper_billing_incomplete");
    person.billing.billing_company_id = "123456789";
    expect(() => buildCreatePayperInvoice(person, "103059585", gateway())).toThrow("payper_billing_incomplete");
    person.billing.billing_company_id = "000000018";
    expect(buildCreatePayperInvoice(person, "103059585", gateway()).PayperParameters.DataPayper.customer_unique_id)
      .toBe("000000018");
  });

  test("reconciles gross line prices in agorot without rounding or adding VAT", () => {
    const twoUnits = facts();
    twoUnits.amount = 119.9;
    twoUnits.checkoutSnapshot.items = [{ id: "activity", name: "Climbing", qty: 2, customPrice: 59.95 }];
    const data = buildCreatePayperInvoice(twoUnits, "103059585", gateway()).PayperParameters.DataPayper;
    expect(data.invoice_lines).toEqual([{ description: "Climbing", quantity: "2", price_per_unit: "5995",
      include_vat: "true", catalog_id: "activity" }]);
    expect(data.document_rounded).toBe("false");
  });

  test("maps a server-frozen POS discount to the exact VAT-inclusive invoice total", () => {
    const sale = facts();
    sale.orderId = null as never;
    sale.orderNumber = "RCP-123";
    sale.amount = 1;
    sale.checkoutSnapshot.items = [{ id: "bottle", name: "Water", qty: 2, customPrice: 1 }];
    sale.checkoutSnapshot.discount = { type: "הנחה כללית", mode: "fixed", value: 1,
      original_total: 2, final_total: 1 } as never;
    const data = buildCreatePayperInvoice(sale, "103059585", gateway()).PayperParameters.DataPayper;
    expect(data.document_subject).toBe("RCP-123");
    expect(data.invoice_lines).toEqual([{ description: "Water × 2 — הנחה כללית", quantity: "1",
      price_per_unit: "100", include_vat: "true", catalog_id: "bottle" }]);
  });
  test("rejects a discounted source whose frozen line math disagrees with the charged amount", () => {
    const sale = facts();sale.orderId = null as never;sale.orderNumber = "RCP-124";sale.amount = 0.90;
    sale.checkoutSnapshot.items = [{ id: "bottle", name: "Water", qty: 1, customPrice: 1 }];
    sale.checkoutSnapshot.discount = { type: "הנחה כללית", mode: "percentage", value: 10,
      original_total: 1, final_total: 0.90 } as never;
    expect(buildCreatePayperInvoice(sale, "103059585", gateway()).PayperParameters.DataPayper.invoice_lines[0].price_per_unit).toBe("90");
    sale.amount = 0.89;
    expect(() => buildCreatePayperInvoice(sale, "103059585", gateway())).toThrow("payper_discount_mapping_required");
  });

  test("does not issue an invoice whose only service description is an order number", () => {
    const incomplete = facts();
    incomplete.checkoutSnapshot.items[0].name = incomplete.orderNumber;
    expect(() => buildCreatePayperInvoice(incomplete, "103059585", gateway()))
      .toThrow("payper_description_required");
  });

  test("requests documented Payper mail only when explicitly configured and a frozen email is valid", () => {
    const source = facts();
    const defaultRequest = buildCreatePayperInvoice(source, "103059585", gateway());
    expect(defaultRequest.PayperParameters.DataPayper).not.toHaveProperty("send_by_mail");
    const mailRequest = buildCreatePayperInvoice(source, "103059585", gateway(), { sendByMail: true });
    expect(mailRequest.PayperParameters.DataPayper).toMatchObject({
      customer_mail: "billing@example.test", send_by_mail: "true",
    });
    const longEmail = `billing@${["a", "b", "c", "d"].map(letter => letter.repeat(50)).join(".")}.example.test`;
    source.billing.billing_accounting_email = longEmail;
    expect(buildCreatePayperInvoice(source, "103059585", gateway(), { sendByMail: true })
      .PayperParameters.DataPayper.customer_mail).toBe(longEmail);
    source.billing.billing_accounting_email = "invalid";
    expect(() => buildCreatePayperInvoice(source, "103059585", gateway(), { sendByMail: true }))
      .toThrow("payper_email_required");
  });

  test("read-only lookup uses documented method and credentials; creation stays disabled", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ StatusCode: "000", ResultData: {
      TransactionId: "hosted-session-123", TransactionPelecardId: 103059585,
      ShvaResult: "000", DebitTotal: "11800", DebitCurrency: "1",
    } }), { status: 200 }));
    const provider = createPelecardPayperProvider({ credentials: gateway(), fetcher });
    expect(await provider.lookupTransaction("hosted-session-123", 11800)).toBe("103059585");
    expect(fetcher).toHaveBeenCalledWith("https://gateway21.pelecard.biz/PaymentGW/GetTransaction", expect.objectContaining({ method: "POST" }));
    await expect(provider.createInvoice(buildCreatePayperInvoice(facts(), "103059585", gateway()), "reservation-1")).rejects.toThrow("payper_dispatch_disabled");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("classifies Pelecard 501 before any invoice dispatch", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ StatusCode: "501", ResultData: null }), { status: 200 }));
    const provider = createPelecardPayperProvider({ credentials: gateway(), fetcher, dispatchEnabled: true });
    await expect(provider.lookupTransaction("hosted-session-123", 300)).rejects.toThrow("provider_credentials_rejected");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://gateway21.pelecard.biz/PaymentGW/GetTransaction");
  });

  test("mocked dispatch validates success and treats rejection or timeout as reconciliation", async () => {
    const success = { StatusCode: "000", PayperData: { InvoiceStatus: "Success", InvoiceNumber: "595170", InvoiceLink: "https://app.payper.co.il/public/invoice_show/595170?ak=opaque" } };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(success), { status: 200 }));
    const provider = createPelecardPayperProvider({ credentials: gateway(), fetcher, dispatchEnabled: true });
    const request = buildCreatePayperInvoice(facts(), "103059585", gateway());
    expect(await provider.createInvoice(request, "reservation-1")).toMatchObject({ state: "succeeded", documentNumber: "595170" });
    expect(fetcher).toHaveBeenCalledWith("https://gateway21.pelecard.biz/services/CreatePayperInvoice", expect.objectContaining({ method: "POST" }));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(success), { status: 502 }));
    expect(await provider.createInvoice(request, "reservation-http-error")).toMatchObject({ state: "reconciliation_required", safeCode: "provider_http_error" });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ StatusCode: "111", PayperData: { InvoiceStatus: "Error" } }), { status: 200 }));
    expect(await provider.createInvoice(request, "reservation-2")).toMatchObject({ state: "reconciliation_required", safeCode: "provider_ip_rejected" });
    fetcher.mockRejectedValueOnce(new Error("secret-bearing transport failure"));
    expect(await provider.createInvoice(request, "reservation-3")).toMatchObject({ state: "reconciliation_required", safeCode: "provider_transport_uncertain" });
  });
});
