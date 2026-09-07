import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { createPelecardRefundHandler } from "../../../../supabase/functions/_shared/payment-refund.ts";
import { PaymentError } from "../../../../supabase/functions/_shared/payment-types.ts";

const PAYMENT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000002";
const ADJUSTMENT_ID = "10000000-0000-4000-8000-000000000003";
const endpointPath = fileURLToPath(new URL(
  "../../../../supabase/functions/pelecard-refund/index.ts",
  import.meta.url,
));

function request(body = {
  paymentId: PAYMENT_ID,
  operation: "refund",
  idempotencyKey: "refund-attempt-1",
}) {
  return new Request("https://edge.example.test/pelecard-refund", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-token",
      Origin: "https://app.example.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides = {}) {
  return {
    auth: {
      authenticate: vi.fn().mockResolvedValue({ id: USER_ID, role: "admin" }),
    },
    store: {
      getOriginal: vi.fn().mockResolvedValue({
        id: PAYMENT_ID,
        status: "succeeded",
        providerTransactionId: "provider-original-1",
        amountMinor: 12_000,
        currencyCode: "ILS",
      }),
      reserve: vi.fn().mockResolvedValue({
        created: true,
        adjustment: {
          id: ADJUSTMENT_ID,
          parentPaymentId: PAYMENT_ID,
          operation: "refund",
          status: "refund_pending",
        },
      }),
      complete: vi.fn().mockResolvedValue({
        id: ADJUSTMENT_ID,
        parentPaymentId: PAYMENT_ID,
        operation: "refund",
        status: "refunded",
      }),
    },
    provider: {
      adjust: vi.fn().mockResolvedValue({
        providerTransactionId: "provider-refund-1",
        approvalId: "approval-refund-1",
        statusCode: "000",
      }),
    },
    createAdjustmentId: () => ADJUSTMENT_ID,
    config: {
      allowedAppOrigins: ["https://app.example.test"],
      maxBodyBytes: 4_096,
      enabled: false,
    },
    ...overrides,
  };
}

describe("Pelecard refund/void capability gate", () => {
  test("ships a dedicated Edge Function that is disabled unless explicitly enabled", () => {
    expect(existsSync(endpointPath)).toBe(true);
    const source = readFileSync(endpointPath, "utf8");
    expect(source).toContain("PELECARD_REFUND_ENABLED");
    expect(source).not.toMatch(/https?:\/\/|fetch\s*\(/);
  });

  test("fails closed before reading payment state or calling the provider", async () => {
    const deps = dependencies();
    const response = await createPelecardRefundHandler(deps)(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "capability_disabled" } });
    expect(deps.store.getOriginal).not.toHaveBeenCalled();
    expect(deps.provider.adjust).not.toHaveBeenCalled();
  });

  test("allows only admin and operations roles when enabled", async () => {
    for (const role of ["cashier", "instructor"]) {
      const deps = dependencies({
        auth: { authenticate: vi.fn().mockResolvedValue({ id: USER_ID, role }) },
        config: { ...dependencies().config, enabled: true },
      });
      const response = await createPelecardRefundHandler(deps)(request());
      expect(response.status).toBe(403);
      expect(deps.store.getOriginal).not.toHaveBeenCalled();
    }
  });

  test.each([
    [{ paymentId: "bad", operation: "refund", idempotencyKey: "refund-attempt-1" }],
    [{ paymentId: PAYMENT_ID, operation: "chargeback", idempotencyKey: "refund-attempt-1" }],
    [{ paymentId: PAYMENT_ID, operation: "refund", idempotencyKey: "short" }],
    [{ paymentId: PAYMENT_ID, operation: "refund", idempotencyKey: "refund-attempt-1", amount: 1 }],
  ])("rejects malformed or expanded adjustment input", async (body) => {
    const deps = dependencies({
      config: { ...dependencies().config, enabled: true },
    });
    const response = await createPelecardRefundHandler(deps)(request(body));
    expect(response.status).toBe(400);
    expect(deps.provider.adjust).not.toHaveBeenCalled();
  });

  test.each([
    ["initiated"], ["pending_provider"], ["failed"], ["timed_out"],
    ["refund_pending"], ["refunded"], ["void_pending"], ["voided"],
  ])("does not adjust an original payment in %s state", async (status) => {
    const deps = dependencies({
      config: { ...dependencies().config, enabled: true },
    });
    deps.store.getOriginal.mockResolvedValue({
      id: PAYMENT_ID,
      status,
      providerTransactionId: "provider-original-1",
      amountMinor: 12_000,
      currencyCode: "ILS",
    });
    const response = await createPelecardRefundHandler(deps)(request());
    expect(response.status).toBe(409);
    expect(deps.store.reserve).not.toHaveBeenCalled();
    expect(deps.provider.adjust).not.toHaveBeenCalled();
  });

  test.each([
    ["refund", "refund_pending", "refunded"],
    ["void", "void_pending", "voided"],
  ])("supports deterministic injected %s behavior only when enabled", async (
    operation,
    pendingStatus,
    completeStatus,
  ) => {
    const deps = dependencies({
      config: { ...dependencies().config, enabled: true },
    });
    deps.store.reserve.mockResolvedValue({
      created: true,
      adjustment: {
        id: ADJUSTMENT_ID,
        parentPaymentId: PAYMENT_ID,
        operation,
        status: pendingStatus,
      },
    });
    deps.store.complete.mockResolvedValue({
      id: ADJUSTMENT_ID,
      parentPaymentId: PAYMENT_ID,
      operation,
      status: completeStatus,
    });

    const response = await createPelecardRefundHandler(deps)(request({
      paymentId: PAYMENT_ID,
      operation,
      idempotencyKey: `${operation}-attempt-1`,
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      paymentId: PAYMENT_ID,
      adjustmentId: ADJUSTMENT_ID,
      operation,
      status: completeStatus,
    });
    expect(deps.provider.adjust).toHaveBeenCalledWith({
      operation,
      originalProviderTransactionId: "provider-original-1",
      amountMinor: 12_000,
      currencyCode: "ILS",
      merchantCorrelation: ADJUSTMENT_ID,
    });
  });

  test("returns an idempotent completed adjustment without another provider call", async () => {
    const deps = dependencies({
      config: { ...dependencies().config, enabled: true },
    });
    deps.store.reserve.mockResolvedValue({
      created: false,
      adjustment: {
        id: ADJUSTMENT_ID,
        parentPaymentId: PAYMENT_ID,
        operation: "refund",
        status: "refunded",
      },
    });
    const response = await createPelecardRefundHandler(deps)(request());
    expect(response.status).toBe(200);
    expect(deps.provider.adjust).not.toHaveBeenCalled();
  });

  test("fails closed when the enabled runtime lacks a confirmed provider contract", async () => {
    const deps = dependencies({
      config: { ...dependencies().config, enabled: true },
      provider: {
        adjust: vi.fn().mockRejectedValue(new PaymentError("capability_unconfigured")),
      },
    });
    const response = await createPelecardRefundHandler(deps)(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "capability_unconfigured" },
      adjustmentId: ADJUSTMENT_ID,
    });
  });
});
