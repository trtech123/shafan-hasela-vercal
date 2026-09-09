import { describe, expect, test } from "vitest";
import { mapOrderToAccountingSource } from "../rivhit/order-mapper.ts";
import type { DocumentMapping } from "../rivhit/types.ts";
import {
  mapVerifiedPaymentToAccountingSource,
  PaymentAccountingReconciliationError,
} from "./payment-mapper.ts";

const paymentId = "22222222-2222-4222-8222-222222222222";
const orderId = "11111111-1111-4111-8111-111111111111";
const mapping: DocumentMapping = {
  document_type: 1,
  sort_code: 100,
  currency_id: 1,
  price_include_vat: true,
  send_mail: false,
  digital_signature: false,
};

const order = {
  id: orderId,
  order_number: "ORD-1234",
  client_name: "Private Contact",
  client_phone: "050-123-4567",
  client_email: "person@example.com",
  organization: "Client Organization",
  billing_institution_name: "Institution Billing Name",
  billing_company_id: "51-234567-8",
  billing_accounting_email: "billing@example.com",
  num_participants: 12,
  price_per_person: 75.5,
  total_price: 906,
};

function verifiedSource(overrides: Record<string, unknown> = {}) {
  return {
    id: paymentId,
    provider: "pelecard" as const,
    operation: "payment" as const,
    status: "succeeded" as const,
    orderId,
    saleId: "33333333-3333-4333-8333-333333333333",
    providerTransactionId: "provider-transaction-secret",
    amountMinor: 9001,
    currencyCode: "ILS",
    verifiedAt: "2026-09-09T10:00:00.000Z",
    checkoutItems: [
      { id: "activity", name: "Rope Course", quantity: 2, unitPriceMinor: 5000 },
    ],
    order,
    activityName: "Mutable activity name",
    ...overrides,
  };
}

describe("verified payment to Rivhit mapping", () => {
  test("uses the local payment identity, immutable paid amount, and semantic purpose", async () => {
    const result = await mapVerifiedPaymentToAccountingSource(
      verifiedSource(),
      mapping,
      "official-sandbox",
    );

    expect(result).toMatchObject({
      provider: "rivhit",
      accountNamespace: "official-sandbox",
      sourceType: "payment_transaction",
      sourceId: paymentId,
      documentTypeKey: "payment_success",
      paymentAmountMinor: 9001,
      currencyCode: "ILS",
      documentRequestReference:
        `shafan:rivhit:payment:${paymentId}:payment_success`,
    });
    expect(result.document.items).toEqual([{
      item_id: 0,
      quantity: 1,
      price_nis: 90.01,
      description: expect.stringContaining("Rope Course"),
    }]);
    expect(result.document.items.reduce(
      (sum, item) => sum + item.quantity * item.price_nis,
      0,
    )).toBe(90.01);
  });

  test("reuses the order billing and contact customer identity exactly", async () => {
    const payment = await mapVerifiedPaymentToAccountingSource(
      verifiedSource(),
      mapping,
      "official-sandbox",
    );
    const mappedOrder = await mapOrderToAccountingSource(
      order,
      "Rope Course",
      "sandbox_test",
      mapping,
      "official-sandbox",
    );

    expect(payment.customer).toEqual(mappedOrder.customer);
    expect(payment.identityKey).toBe(mappedOrder.identityKey);
    expect(payment.externalCustomerReference).toBe(
      mappedOrder.externalCustomerReference,
    );
    expect(payment.customerRequestReference).toBe(
      mappedOrder.customerRequestReference,
    );
  });

  test("does not derive the document amount from mutable order totals or checkout gross totals", async () => {
    const result = await mapVerifiedPaymentToAccountingSource(
      verifiedSource({
        amountMinor: 7999,
        order: { ...order, total_price: 123456, price_per_person: 9876 },
        checkoutItems: [
          { id: "a", name: "Climbing", quantity: 3, unitPriceMinor: 3333 },
          { id: "b", name: "Equipment", quantity: 1, unitPriceMinor: 2500 },
        ],
      }),
      mapping,
      "official-sandbox",
    );

    expect(result.document.items).toHaveLength(1);
    expect(result.document.items[0]).toMatchObject({ quantity: 1, price_nis: 79.99 });
    expect(result.document.items[0].description).toContain("Climbing");
  });

  test("produces stable hashes and keeps payments on one order distinct", async () => {
    const first = await mapVerifiedPaymentToAccountingSource(
      verifiedSource(), mapping, "official-sandbox",
    );
    const repeated = await mapVerifiedPaymentToAccountingSource(
      verifiedSource(), mapping, "official-sandbox",
    );
    const second = await mapVerifiedPaymentToAccountingSource(
      verifiedSource({ id: "44444444-4444-4444-8444-444444444444" }),
      mapping,
      "official-sandbox",
    );

    expect(repeated).toEqual(first);
    expect(first.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.sourceId).not.toBe(first.sourceId);
    expect(second.documentRequestReference).not.toBe(first.documentRequestReference);
    expect(second.payloadHash).not.toBe(first.payloadHash);
    expect(second.identityKey).toBe(first.identityKey);
  });

  test("does not copy callback or provider-body fields into the accounting request", async () => {
    const result = await mapVerifiedPaymentToAccountingSource(
      verifiedSource({
        rawCallbackBody: "do-not-copy-callback-secret",
        providerPayload: { CardNumber: "do-not-copy-pan" },
        checkoutItems: [{
          id: "activity",
          name: "Rope Course",
          quantity: 2,
          unitPriceMinor: 5000,
          rawProviderField: "do-not-copy-provider-field",
        }],
      }),
      mapping,
      "official-sandbox",
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("do-not-copy-callback-secret");
    expect(serialized).not.toContain("do-not-copy-pan");
    expect(serialized).not.toContain("do-not-copy-provider-field");
    expect(serialized).not.toContain("provider-transaction-secret");
  });

  test.each([
    ["missing_order", null],
    [
      "missing_billing_identity",
      {
        ...order,
        client_name: "",
        organization: null,
        billing_institution_name: null,
      },
    ],
  ])("requires real order billing context: %s", async (code, sourceOrder) => {
    await expect(mapVerifiedPaymentToAccountingSource(
      verifiedSource({ order: sourceOrder }),
      mapping,
      "official-sandbox",
    )).rejects.toMatchObject({
      name: "PaymentAccountingReconciliationError",
      code,
    } satisfies Partial<PaymentAccountingReconciliationError>);
  });
});
