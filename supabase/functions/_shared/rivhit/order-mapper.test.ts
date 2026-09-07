import { describe, expect, test } from "vitest";
import { mapOrderToAccountingSource } from "./order-mapper.ts";
import type { DocumentMapping, OrderSource } from "./types.ts";

const mapping: DocumentMapping = {
  document_type: 1,
  sort_code: 100,
  currency_id: 1,
  price_include_vat: true,
  send_mail: false,
  digital_signature: false,
};
const accountNamespace = "official-sandbox";

const order: OrderSource = {
  id: "11111111-1111-4111-8111-111111111111",
  order_number: "ORD-1234",
  client_name: "Private Contact",
  client_phone: "050-123-4567",
  client_email: "person@example.com",
  organization: "Client Organization",
  billing_institution_name: "Institution Billing Name",
  billing_company_id: "51-234567-8",
  billing_accounting_email: "billing@example.com",
  num_participants: 12,
  price_per_person: "75.50",
  total_price: 906,
};

describe("order to Rivhit mapping", () => {
  test("uses billing priority while storing only a hashed identity", async () => {
    const result = await mapOrderToAccountingSource(order, "Climbing Day", "sandbox_test", mapping, accountNamespace);

    expect(result.customer.last_name).toBe("Institution Billing Name");
    expect(result.customer.email).toBe("billing@example.com");
    expect(result.customer.phone).toBe("050-123-4567");
    expect(result.identityKey).toMatch(/^[a-f0-9]{64}$/);
    expect(result.identityKey).not.toContain("512345678");
    expect(result.externalCustomerReference).toMatch(/^sh[a-f0-9]{18}$/);
    expect(result.externalCustomerReference).toHaveLength(20);
    expect(result.customer).not.toHaveProperty("vat_number");
    expect(result.customer).not.toHaveProperty("id_number");
    expect(result.accountNamespace).toBe(accountNamespace);
  });

  test("maps order amounts and configurable document behavior", async () => {
    const result = await mapOrderToAccountingSource(order, "Climbing Day", "sandbox_test", mapping, accountNamespace);

    expect(result.document).toMatchObject({
      document_type: 1,
      last_name: "Institution Billing Name",
      order: "ORD-1234",
      sort_code: 100,
      price_include_vat: true,
      currency_id: 1,
      send_mail: false,
      digital_signature: false,
      prevent_duplicates: true,
      create_items: false,
      no_update_inventory: true,
    });
    expect(result.document.email_to).toBeUndefined();
    expect(result.document.items).toEqual([
      {
        item_id: 0,
        quantity: 12,
        price_nis: 75.5,
        description: "Climbing Day / ORD-1234",
      },
    ]);
  });

  test("falls back to one total-price item when per-person pricing is incomplete", async () => {
    const result = await mapOrderToAccountingSource(
      { ...order, num_participants: null, price_per_person: null, total_price: "906" },
      null,
      "sandbox_test",
      mapping,
      accountNamespace,
    );

    expect(result.document.items).toEqual([
      {
        item_id: 0,
        quantity: 1,
        price_nis: 906,
        description: "Shafan order / ORD-1234",
      },
    ]);
  });

  test("produces stable references and hashes for the same operation", async () => {
    const first = await mapOrderToAccountingSource(order, "Climbing Day", "sandbox_test", mapping, accountNamespace);
    const second = await mapOrderToAccountingSource(order, "Climbing Day", "sandbox_test", mapping, accountNamespace);
    const otherType = await mapOrderToAccountingSource(order, "Climbing Day", "other_type", mapping, accountNamespace);

    expect(second).toEqual(first);
    expect(first.documentRequestReference).toBe(
      "shafan:rivhit:order:11111111-1111-4111-8111-111111111111:sandbox_test",
    );
    expect(otherType.documentRequestReference).not.toBe(first.documentRequestReference);
    expect(otherType.payloadHash).not.toBe(first.payloadHash);
  });

  test("rejects orders without a positive amount", async () => {
    await expect(
      mapOrderToAccountingSource(
        { ...order, num_participants: null, price_per_person: null, total_price: 0 },
        "Climbing Day",
        "sandbox_test",
        mapping,
        accountNamespace,
      ),
    ).rejects.toThrow("Order has no positive accounting amount");
  });
});
