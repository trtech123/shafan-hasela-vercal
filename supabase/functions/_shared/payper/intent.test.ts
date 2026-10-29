import { describe, expect, test } from "vitest";
import { preparePayperIntent } from "./intent.ts";

const input = () => ({
  payment: {
    id: "payment-1", provider: "pelecard", operation: "payment", status: "succeeded",
    createdAt: "2026-10-21T08:59:00Z",
    verifiedAt: "2026-10-21T09:00:00Z", providerTransactionId: "1234567890",
    orderId: "order-1", saleId: "sale-1", amountMinor: 11800, currencyCode: "ILS",
    checkoutItems: [{ id: "activity-1", name: "Activity", quantity: 1, unitPriceMinor: 11800 }],
  },
  sale: { id: "sale-1", orderId: "order-1", paymentId: "payment-1", amountMinor: 11800 },
  order: { id: "order-1", orderNumber: "ORD-1", saleId: "sale-1", amountMinor: 11800, customerSnapshotId: "snapshot-1" },
  customerSnapshot: {
    id: "snapshot-1", orderId: "order-1", customerId: "customer-1", version: 3,
    kind: "organization", billingName: "Example Ltd", companyId: "512783333",
    accountingEmail: "accounts@example.test", vatApplicable: true,
  },
  activationCutoffUtc: "2026-10-21T08:59:00Z",
});

describe("Payper local intent", () => {
  test("seals verified payment and frozen company billing facts without a provider request", async () => {
    const result = await preparePayperIntent(input());
    expect(result.status).toBe("source_complete");
    if (result.status !== "source_complete") return;
    expect(result.intent).toMatchObject({
      paymentId: "payment-1", pelecardTransactionId: "1234567890",
      verifiedAt: "2026-10-21T09:00:00Z",
      orderId: "order-1", saleId: "sale-1", amountMinor: 11800, currencyCode: "ILS",
      customerSnapshotId: "snapshot-1", customerSnapshotVersion: 3,
      customerName: "Example Ltd", customerUniqueId: "512783333",
      customerEmail: "accounts@example.test", vatApplicable: true,
    });
    expect(result.intent.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.intent)).not.toMatch(/password|apiKey|invoice_lines|receipt_lines/i);
  });

  test("requires a person identity while the account identity setting is enabled", async () => {
    const value = input();
    value.customerSnapshot.kind = "person";
    value.customerSnapshot.companyId = "";
    const result = await preparePayperIntent(value);
    expect(result).toEqual({ status: "missing_fields", fields: ["company_id"] });
    value.customerSnapshot.companyId = "000000018";
    const complete = await preparePayperIntent(value);
    expect(complete.status).toBe("source_complete");
    if (complete.status === "source_complete") expect(complete.intent.customerUniqueId).toBe("000000018");
  });

  test("reports missing person email and does not substitute a signer ID", async () => {
    const value = input();
    value.customerSnapshot.kind = "person";
    value.customerSnapshot.companyId = "";
    value.customerSnapshot.accountingEmail = "";
    expect(await preparePayperIntent(value)).toEqual({ status: "missing_fields", fields: ["company_id", "customer_email_or_identity"] });
  });

  test("requires a valid company number for organization billing", async () => {
    const value = input();
    value.customerSnapshot.companyId = "123";
    expect(await preparePayperIntent(value)).toEqual({ status: "missing_fields", fields: ["company_id"] });
  });

  test("requires explicit VAT and immutable source linkage", async () => {
    const value = input();
    (value.customerSnapshot.vatApplicable as boolean | null) = null;
    value.sale.paymentId = "other";
    expect(await preparePayperIntent(value)).toEqual({ status: "missing_fields", fields: ["sale_payment_link", "vat_decision"] });
  });

  test("rejects unverified payment and amount or currency conflicts", async () => {
    const value = input();
    value.payment.status = "pending_provider";
    value.payment.currencyCode = "USD";
    value.order.amountMinor = 11700;
    expect(await preparePayperIntent(value)).toEqual({ status: "missing_fields", fields: ["verified_payment", "ils_payment", "order_amount_match"] });
  });

  test("fingerprint changes with frozen customer or item facts", async () => {
    const first = await preparePayperIntent(input());
    const changed = input();
    changed.customerSnapshot.billingName = "Other Ltd";
    const second = await preparePayperIntent(changed);
    expect(first.status).toBe("source_complete");
    expect(second.status).toBe("source_complete");
    if (first.status === "source_complete" && second.status === "source_complete") {
      expect(first.intent.fingerprint).not.toBe(second.intent.fingerprint);
    }
  });

  test("verification time is frozen and changes the fingerprint", async () => {
    const value = input();
    const first = await preparePayperIntent(value);
    value.payment.verifiedAt = "2026-10-21T09:01:00Z";
    const second = await preparePayperIntent(value);
    expect(first.status).toBe("source_complete");
    expect(second.status).toBe("source_complete");
    if (first.status === "source_complete" && second.status === "source_complete") {
      expect(first.intent.verifiedAt).toBe("2026-10-21T09:00:00Z");
      expect(first.intent.fingerprint).not.toBe(second.intent.fingerprint);
    }
  });

  test("excludes attempts initiated before activation even when verification is delayed", async () => {
    const value = input(); value.payment.createdAt = "2026-10-21T08:58:59Z";
    expect(await preparePayperIntent(value)).toEqual({ status: "missing_fields", fields: ["activation_cutoff"] });
  });
});
