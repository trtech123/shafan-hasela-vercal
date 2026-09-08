import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import {
  beginHostedPelecardPayment,
  getPelecardStatus,
  initiatePelecardPayment,
  PELECARD_PENDING_PAYMENT_KEY,
  pollPelecardStatus,
  verifyPelecardReturn,
} from "./pelecardPayments.js";

const PAYMENT_ID = "10000000-0000-4000-8000-000000000001";
const checkout = {
  schema_version: 1,
  items: [{ id: "a1", name: "Activity", qty: 1, customPrice: 120 }],
  discount: null,
  linked_order_info: null,
  sale_date: "2026-09-08",
};

function clientWith(data) {
  return { functions: { invoke: vi.fn().mockResolvedValue({ data, error: null }) } };
}

describe("Pelecard frontend API", () => {
  test("initiates through the Edge Function and returns only the hosted URL and local ID", async () => {
    const client = clientWith({
      paymentId: PAYMENT_ID,
      status: "pending_provider",
      redirectUrl: "https://sandbox.pelecard.example/checkout/abc",
      raw: { cardNumber: "4111111111111111" },
    });
    const result = await initiatePelecardPayment({
      idempotencyKey: "checkout-attempt-1",
      orderId: null,
      checkout,
    }, {
      client,
      allowedRedirectOrigins: ["https://sandbox.pelecard.example"],
    });

    expect(client.functions.invoke).toHaveBeenCalledWith("pelecard-initiate", {
      body: { idempotencyKey: "checkout-attempt-1", orderId: null, checkout },
    });
    expect(result).toEqual({
      paymentId: PAYMENT_ID,
      status: "pending_provider",
      redirectUrl: "https://sandbox.pelecard.example/checkout/abc",
    });
  });

  test.each([
    "http://sandbox.pelecard.example/checkout/abc",
    "https://user:pass@sandbox.pelecard.example/checkout/abc",
    "https://sandbox.pelecard.example.evil.test/checkout/abc",
    "https://sandbox.pelecard.example:444/checkout/abc",
  ])("refuses an unsafe or non-allowlisted redirect: %s", async (redirectUrl) => {
    const client = clientWith({ paymentId: PAYMENT_ID, status: "pending_provider", redirectUrl });
    await expect(initiatePelecardPayment({
      idempotencyKey: "checkout-attempt-1",
      orderId: null,
      checkout,
    }, {
      client,
      allowedRedirectOrigins: ["https://sandbox.pelecard.example"],
    })).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("stores only local correlation state before navigating to the hosted URL", async () => {
    const client = clientWith({
      paymentId: PAYMENT_ID,
      status: "pending_provider",
      redirectUrl: "https://sandbox.pelecard.example/checkout/abc",
    });
    const storage = {
      value: null,
      getItem: vi.fn(() => null),
      setItem: vi.fn((_, value) => { storage.value = value; }),
    };
    const location = { assign: vi.fn() };

    await beginHostedPelecardPayment({ orderId: null, checkout }, {
      client,
      storage,
      location,
      createIdempotencyKey: () => "checkout-attempt-1",
      allowedRedirectOrigins: ["https://sandbox.pelecard.example"],
    });

    expect(JSON.parse(storage.value)).toEqual({
      idempotencyKey: "checkout-attempt-1",
      paymentId: PAYMENT_ID,
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      PELECARD_PENDING_PAYMENT_KEY,
      storage.value,
    );
    expect(location.assign).toHaveBeenCalledWith(
      "https://sandbox.pelecard.example/checkout/abc",
    );
  });

  test("reuses the stored idempotency key after a repeated browser submission", async () => {
    const client = clientWith({
      paymentId: PAYMENT_ID,
      status: "pending_provider",
      redirectUrl: "https://sandbox.pelecard.example/checkout/abc",
    });
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ idempotencyKey: "existing-attempt-1" })),
      setItem: vi.fn(),
    };
    await beginHostedPelecardPayment({ orderId: null, checkout }, {
      client,
      storage,
      location: { assign: vi.fn() },
      createIdempotencyKey: () => "must-not-be-used",
      allowedRedirectOrigins: ["https://sandbox.pelecard.example"],
    });
    expect(client.functions.invoke).toHaveBeenCalledWith("pelecard-initiate", {
      body: expect.objectContaining({ idempotencyKey: "existing-attempt-1" }),
    });
  });

  test("starts a fresh attempt after the stored checkout already has a payment ID", async () => {
    const client = clientWith({
      paymentId: "20000000-0000-4000-8000-000000000001",
      status: "pending_provider",
      redirectUrl: "https://sandbox.pelecard.example/checkout/new",
    });
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        idempotencyKey: "completed-attempt-1",
        paymentId: PAYMENT_ID,
      })),
      setItem: vi.fn(),
    };
    await beginHostedPelecardPayment({ orderId: null, checkout }, {
      client,
      storage,
      location: { assign: vi.fn() },
      createIdempotencyKey: () => "fresh-attempt-1",
      allowedRedirectOrigins: ["https://sandbox.pelecard.example"],
    });
    expect(client.functions.invoke).toHaveBeenCalledWith("pelecard-initiate", {
      body: expect.objectContaining({ idempotencyKey: "fresh-attempt-1" }),
    });
  });

  test("sends browser-return data only to verification and never treats it as status", async () => {
    const client = clientWith({ paymentId: PAYMENT_ID, status: "pending_provider" });
    const notification = { opaque: "provider-notice" };
    await verifyPelecardReturn(PAYMENT_ID, notification, { client });
    expect(client.functions.invoke).toHaveBeenCalledWith("pelecard-verify", {
      body: { paymentId: PAYMENT_ID, notification },
    });
  });

  test("projects allowlisted status fields and discards unexpected provider/card fields", async () => {
    const client = clientWith({
      id: PAYMENT_ID,
      orderId: null,
      saleId: "sale-1",
      amount: "120.00",
      currency: "ILS",
      status: "succeeded",
      failureCode: null,
      receiptNumber: "RCP-1001",
      createdAt: "2026-09-08T10:00:00Z",
      updatedAt: "2026-09-08T10:01:00Z",
      verifiedAt: "2026-09-08T10:01:00Z",
      providerTransactionId: "must-not-pass",
      cardNumber: "4111111111111111",
    });
    expect(await getPelecardStatus(PAYMENT_ID, { client })).toEqual({
      id: PAYMENT_ID,
      orderId: null,
      saleId: "sale-1",
      amount: "120.00",
      currency: "ILS",
      status: "succeeded",
      failureCode: null,
      receiptNumber: "RCP-1001",
      createdAt: "2026-09-08T10:00:00Z",
      updatedAt: "2026-09-08T10:01:00Z",
      verifiedAt: "2026-09-08T10:01:00Z",
    });
  });

  test("polls status without any sale or order write and stops on success", async () => {
    const client = { functions: { invoke: vi.fn()
      .mockResolvedValueOnce({ data: {
        id: PAYMENT_ID, orderId: null, saleId: null, amount: "120.00",
        currency: "ILS", status: "pending_provider", failureCode: null,
        receiptNumber: null, createdAt: "a", updatedAt: "a", verifiedAt: null,
      }, error: null })
      .mockResolvedValueOnce({ data: {
        id: PAYMENT_ID, orderId: null, saleId: "sale-1", amount: "120.00",
        currency: "ILS", status: "succeeded", failureCode: null,
        receiptNumber: "RCP-1001", createdAt: "a", updatedAt: "b", verifiedAt: "b",
      }, error: null }) } };
    const wait = vi.fn().mockResolvedValue(undefined);
    const result = await pollPelecardStatus(PAYMENT_ID, {
      client,
      wait,
      intervalMs: 1,
      maxAttempts: 4,
    });
    expect(result.status).toBe("succeeded");
    expect(client.functions.invoke).toHaveBeenCalledTimes(2);
    expect(client.functions.invoke).toHaveBeenNthCalledWith(1, "pelecard-status", {
      body: { paymentId: PAYMENT_ID },
    });
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test("contains no direct sales/orders persistence path", () => {
    const source = readFileSync(new URL("./pelecardPayments.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/\.from\s*\(\s*["'](?:sales|orders)["']/);
    expect(source).not.toMatch(/\.insert\s*\(|\.update\s*\(/);
  });
});
