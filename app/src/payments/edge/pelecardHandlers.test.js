import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createPelecardCallbackHandler,
  createPelecardStatusHandler,
  createPelecardVerifyHandler,
} from "../../../../supabase/functions/_shared/payment-handlers.ts";
import {
  createSupabasePaymentVerificationStore,
} from "../../../../supabase/functions/_shared/payment-store.ts";
import { PaymentError } from "../../../../supabase/functions/_shared/payment-types.ts";

const PAYMENT_ID = "11111111-1111-4111-8111-111111111111";
const SALE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const PROVIDER_TRANSACTION_ID = "provider-transaction-1";

const pendingPayment = {
  id: PAYMENT_ID,
  orderId: null,
  saleId: null,
  amountMinor: 12_000,
  currencyCode: "ILS",
  status: "pending_provider",
  failureCode: null,
  providerTransactionId: null,
  providerSessionReference: "hosted-session-1",
  receiptNumber: null,
  createdAt: "2026-09-08T08:00:00.000Z",
  updatedAt: "2026-09-08T08:00:00.000Z",
  verifiedAt: null,
};

const verifiedTransaction = {
  providerTransactionId: PROVIDER_TRANSACTION_ID,
  approvalId: "approval-1",
  statusCode: "000",
  amountMinor: 12_000,
  currencyCode: "ILS",
  terminalNumber: "sandbox-terminal",
  merchantKey: PAYMENT_ID,
};

function createMemoryStore(initial = pendingPayment) {
  let payment = { ...initial };
  let writes = 0;
  return {
    get writes() {
      return writes;
    },
    getPayment: vi.fn(async (id) => id === payment.id ? { ...payment } : null),
    finalize: vi.fn(async (id, transaction) => {
      if (payment.status === "succeeded") return { ...payment };
      writes += 1;
      payment = {
        ...payment,
        saleId: SALE_ID,
        status: "succeeded",
        providerTransactionId: transaction.providerTransactionId,
        receiptNumber: "RCP-1001",
        verifiedAt: "2026-09-08T08:01:00.000Z",
        updatedAt: "2026-09-08T08:01:00.000Z",
      };
      return { ...payment };
    }),
    markFailed: vi.fn(async (id) => {
      if (payment.status !== "failed") writes += 1;
      payment = {
        ...payment,
        status: "failed",
        failureCode: "provider_declined",
        updatedAt: "2026-09-08T08:01:00.000Z",
      };
      return { ...payment };
    }),
    recordRejected: vi.fn(async () => {}),
  };
}

function createProvider(overrides = {}) {
  return {
    validateConfirmation: vi.fn().mockResolvedValue(true),
    lookup: vi.fn().mockResolvedValue({
      transaction: { ...verifiedTransaction },
      correlationEvidence: {
        kind: "merchant_correlation",
        value: PAYMENT_ID,
      },
    }),
    ...overrides,
  };
}

function decodeNotification({ body }) {
  if (!body || typeof body !== "object") throw new PaymentError("invalid_input");
  const paymentId = body.localPayment;
  const confirmationKey = body.confirmationProof;
  const uniqueKey = body.antiForgeryReference;
  if (![paymentId, confirmationKey, uniqueKey].every((value) =>
    typeof value === "string" && value.length > 0
  )) {
    throw new PaymentError("invalid_input");
  }
  return {
    paymentId,
    confirmationKey,
    uniqueKey,
    providerTransactionId: typeof body.transactionNotice === "string"
      ? body.transactionNotice
      : undefined,
    callbackReference: typeof body.callbackReference === "string"
      ? body.callbackReference
      : undefined,
  };
}

function auth(role = "cashier") {
  return {
    authenticate: vi.fn().mockResolvedValue({ id: USER_ID, role }),
  };
}

function config() {
  return {
    allowedAppOrigins: ["https://app.example.test"],
    maxBodyBytes: 32_768,
    terminalReference: "sandbox-terminal",
    successfulProviderStatusCodes: ["000"],
  };
}

function request(body, {
  contentType = "application/json",
  authorization,
  origin,
  url = "https://edge.example.test/function",
} = {}) {
  const headers = new Headers({ "Content-Type": contentType });
  if (authorization) headers.set("Authorization", authorization);
  if (origin) headers.set("Origin", origin);
  const encoded = contentType === "application/x-www-form-urlencoded"
    ? new URLSearchParams(body).toString()
    : JSON.stringify(body);
  return new Request(url, { method: "POST", headers, body: encoded });
}

function notification(overrides = {}) {
  return {
    localPayment: PAYMENT_ID,
    confirmationProof: "confirmation-key",
    antiForgeryReference: PAYMENT_ID,
    transactionNotice: PROVIDER_TRANSACTION_ID,
    callbackReference: "callback-1",
    ...overrides,
  };
}

function callbackContext(overrides = {}) {
  const store = overrides.store ?? createMemoryStore();
  const provider = overrides.provider ?? createProvider();
  return {
    store,
    provider,
    handler: createPelecardCallbackHandler({
      store,
      provider,
      decodeNotification,
      config: config(),
    }),
  };
}

function verifyContext(overrides = {}) {
  const store = overrides.store ?? createMemoryStore();
  const provider = overrides.provider ?? createProvider();
  const authenticator = overrides.auth ?? auth();
  return {
    store,
    provider,
    auth: authenticator,
    handler: createPelecardVerifyHandler({
      auth: authenticator,
      store,
      provider,
      decodeNotification,
      config: config(),
    }),
  };
}

describe("Pelecard callback and verification", () => {
  test.each(["application/json", "application/x-www-form-urlencoded"])(
    "verifies a bounded %s callback and finalizes once",
    async (contentType) => {
      const context = callbackContext();
      const response = await context.handler(request(notification(), { contentType }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        paymentId: PAYMENT_ID,
        saleId: SALE_ID,
        status: "succeeded",
      });
      expect(context.provider.validateConfirmation).toHaveBeenCalledWith({
        confirmationKey: "confirmation-key",
        uniqueKey: PAYMENT_ID,
        amountMinor: 12_000,
      });
      expect(context.store.finalize).toHaveBeenCalledOnce();
    },
  );

  test("rejects malformed and oversized callbacks before provider access", async () => {
    const context = callbackContext();
    const malformed = await context.handler(request({ unexpected: "value" }));
    const oversized = await context.handler(request({
      ...notification(),
      padding: "x".repeat(33_000),
    }));

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: { code: "invalid_input" } });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: { code: "body_too_large" } });
    expect(context.provider.validateConfirmation).not.toHaveBeenCalled();
    expect(context.provider.lookup).not.toHaveBeenCalled();
    expect(context.store.finalize).not.toHaveBeenCalled();
  });

  test("keeps forged callbacks non-mutating", async () => {
    const provider = createProvider({
      validateConfirmation: vi.fn().mockRejectedValue(
        new PaymentError("forged_callback"),
      ),
    });
    const context = callbackContext({ provider });
    const response = await context.handler(request(notification()));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "forged_callback" } });
    expect(provider.lookup).not.toHaveBeenCalled();
    expect(context.store.writes).toBe(0);
    expect(context.store.recordRejected).toHaveBeenCalledWith(
      PAYMENT_ID,
      "forged_callback",
      "callback",
    );
  });

  test("rejects a callback unique key that differs from the local payment", async () => {
    const context = callbackContext();
    const response = await context.handler(request(notification({
      antiForgeryReference: "attacker-controlled-key",
    })));
    expect(response.status).toBe(400);
    expect(context.provider.validateConfirmation).not.toHaveBeenCalled();
    expect(context.store.recordRejected).toHaveBeenCalledWith(
      PAYMENT_ID,
      "forged_callback",
      "callback",
    );
  });

  test.each([
    ["provider transaction", {
      transaction: { ...verifiedTransaction, providerTransactionId: "other" },
      correlationEvidence: { kind: "merchant_correlation", value: PAYMENT_ID },
    }, "provider_mismatch"],
    ["amount", {
      transaction: { ...verifiedTransaction, amountMinor: 11_999 },
      correlationEvidence: { kind: "merchant_correlation", value: PAYMENT_ID },
    }, "amount_mismatch"],
    ["currency", {
      transaction: { ...verifiedTransaction, currencyCode: "USD" },
      correlationEvidence: { kind: "merchant_correlation", value: PAYMENT_ID },
    }, "currency_mismatch"],
  ])("rejects authoritative %s mismatches without finalization", async (_name, lookup, code) => {
    const context = callbackContext({
      provider: createProvider({ lookup: vi.fn().mockResolvedValue(lookup) }),
    });
    const response = await context.handler(request(notification()));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code } });
    expect(context.store.writes).toBe(0);
    expect(context.store.recordRejected).toHaveBeenCalledWith(
      PAYMENT_ID,
      code,
      "callback",
    );
  });

  test.each(["provider_timeout", "provider_unavailable"])(
    "keeps %s uncertain and pending",
    async (code) => {
      const context = callbackContext({
        provider: createProvider({
          lookup: vi.fn().mockRejectedValue(new PaymentError(code)),
        }),
      });
      const response = await context.handler(request(notification()));

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        paymentId: PAYMENT_ID,
        status: "pending_provider",
      });
      expect(context.store.writes).toBe(0);
    },
  );

  test("marks only a correlated authoritative decline as failed", async () => {
    const context = callbackContext({
      provider: createProvider({
        lookup: vi.fn().mockResolvedValue({
          transaction: { ...verifiedTransaction, statusCode: "006" },
          correlationEvidence: { kind: "merchant_correlation", value: PAYMENT_ID },
        }),
      }),
    });
    const response = await context.handler(request(notification()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      paymentId: PAYMENT_ID,
      saleId: null,
      status: "failed",
    });
    expect(context.store.markFailed).toHaveBeenCalledOnce();
    expect(context.store.finalize).not.toHaveBeenCalled();
  });

  test("does not mark a decline when its amount or currency belongs to another payment", async () => {
    const context = callbackContext({
      provider: createProvider({
        lookup: vi.fn().mockResolvedValue({
          transaction: {
            ...verifiedTransaction,
            statusCode: "006",
            amountMinor: 11_999,
          },
          correlationEvidence: { kind: "merchant_correlation", value: PAYMENT_ID },
        }),
      }),
    });
    const response = await context.handler(request(notification()));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "amount_mismatch" } });
    expect(context.store.markFailed).not.toHaveBeenCalled();
    expect(context.store.recordRejected).toHaveBeenCalledWith(
      PAYMENT_ID,
      "amount_mismatch",
      "callback",
    );
  });

  test("makes a duplicate callback exactly-once and returns the existing sale", async () => {
    const context = callbackContext();
    const first = await context.handler(request(notification()));
    const second = await context.handler(request(notification()));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      paymentId: PAYMENT_ID,
      saleId: SALE_ID,
      status: "succeeded",
    });
    expect(context.store.writes).toBe(1);
    expect(context.store.finalize).toHaveBeenCalledOnce();
  });

  test("supports callback before browser return and repeated authenticated return", async () => {
    const store = createMemoryStore();
    const callback = callbackContext({ store });
    const verify = verifyContext({ store, provider: callback.provider });

    await callback.handler(request(notification()));
    const firstReturn = await verify.handler(request(notification(), {
      authorization: "Bearer valid-jwt",
      origin: "https://app.example.test",
    }));
    const secondReturn = await verify.handler(request(notification(), {
      authorization: "Bearer valid-jwt",
      origin: "https://app.example.test",
    }));

    expect(firstReturn.status).toBe(200);
    expect(secondReturn.status).toBe(200);
    expect(store.writes).toBe(1);
  });

  test("supports browser return before callback without double finalization", async () => {
    const store = createMemoryStore();
    const provider = createProvider();
    const verify = verifyContext({ store, provider });
    const callback = callbackContext({ store, provider });

    const browserReturn = await verify.handler(request(notification(), {
      authorization: "Bearer valid-jwt",
      origin: "https://app.example.test",
    }));
    const callbackResponse = await callback.handler(request(notification()));

    expect(browserReturn.status).toBe(200);
    expect(callbackResponse.status).toBe(200);
    expect(store.writes).toBe(1);
  });

  test("requires authenticated staff for browser verification", async () => {
    const context = verifyContext();
    const response = await context.handler(request(notification(), {
      origin: "https://app.example.test",
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "missing_authorization" },
    });
    expect(context.provider.validateConfirmation).not.toHaveBeenCalled();
  });

  test("audits a forged authenticated browser return as verify input", async () => {
    const context = verifyContext();
    const response = await context.handler(request(notification({
      antiForgeryReference: "attacker-controlled-key",
    }), {
      authorization: "Bearer valid-jwt",
      origin: "https://app.example.test",
    }));

    expect(response.status).toBe(400);
    expect(context.store.recordRejected).toHaveBeenCalledWith(
      PAYMENT_ID,
      "forged_callback",
      "verify",
    );
  });
});

describe("Pelecard status", () => {
  test("returns an exact sanitized projection and repeated reads perform no writes", async () => {
    const store = createMemoryStore({
      ...pendingPayment,
      checkoutSnapshot: { pan: "4111111111111111", cvv: "123" },
      rawProviderPayload: { mustNotEscape: true },
      providerTransactionId: PROVIDER_TRANSACTION_ID,
    });
    const authenticator = auth();
    const handler = createPelecardStatusHandler({
      auth: authenticator,
      store,
      config: config(),
    });
    const statusRequest = () => request({ paymentId: PAYMENT_ID }, {
      authorization: "Bearer valid-jwt",
      origin: "https://app.example.test",
    });

    const first = await handler(statusRequest());
    const second = await handler(statusRequest());
    const body = await first.json();

    expect(first.status).toBe(200);
    expect(await second.json()).toEqual(body);
    expect(body).toEqual({
      id: PAYMENT_ID,
      orderId: null,
      saleId: null,
      amount: "120.00",
      currency: "ILS",
      status: "pending_provider",
      failureCode: null,
      receiptNumber: null,
      createdAt: "2026-09-08T08:00:00.000Z",
      updatedAt: "2026-09-08T08:00:00.000Z",
      verifiedAt: null,
    });
    expect(Object.keys(body)).toEqual([
      "id", "orderId", "saleId", "amount", "currency", "status",
      "failureCode", "receiptNumber", "createdAt", "updatedAt", "verifiedAt",
    ]);
    expect(store.writes).toBe(0);
  });

  test("rejects unauthenticated and invalid payment IDs before lookup", async () => {
    const store = createMemoryStore();
    const missingAuth = createPelecardStatusHandler({
      auth: auth(), store, config: config(),
    });
    const invalid = createPelecardStatusHandler({
      auth: auth(), store, config: config(),
    });

    const unauthorized = await missingAuth(request({ paymentId: PAYMENT_ID }, {
      origin: "https://app.example.test",
    }));
    const invalidId = await invalid(request({ paymentId: "not-a-uuid" }, {
      authorization: "Bearer valid-jwt",
      origin: "https://app.example.test",
    }));

    expect(unauthorized.status).toBe(401);
    expect(invalidId.status).toBe(400);
    expect(store.getPayment).not.toHaveBeenCalled();
  });
});

describe("Supabase verification store", () => {
  const databaseRow = {
    id: PAYMENT_ID,
    order_id: null,
    sale_id: SALE_ID,
    amount: "120.00",
    currency: "ILS",
    status: "succeeded",
    failure_code: null,
    provider_transaction_id: PROVIDER_TRANSACTION_ID,
    provider_session_id: "hosted-session-1",
    receipt_number: "RCP-1001",
    created_at: "2026-09-08T08:00:00.000Z",
    updated_at: "2026-09-08T08:01:00.000Z",
    verified_at: "2026-09-08T08:01:00.000Z",
    checkout_snapshot: { pan: "must-not-map" },
    raw_provider_payload: { mustNotMap: true },
  };

  test("maps only verification fields from the service-role lookup RPC", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: databaseRow, error: null }),
    };
    const store = createSupabasePaymentVerificationStore(client);

    const payment = await store.getPayment(PAYMENT_ID);

    expect(client.rpc).toHaveBeenCalledWith("get_pelecard_payment", {
      p_payment_id: PAYMENT_ID,
    });
    expect(payment).toEqual({ ...pendingPayment,
      saleId: SALE_ID,
      status: "succeeded",
      providerTransactionId: PROVIDER_TRANSACTION_ID,
      receiptNumber: "RCP-1001",
      updatedAt: "2026-09-08T08:01:00.000Z",
      verifiedAt: "2026-09-08T08:01:00.000Z",
    });
    expect(payment).not.toHaveProperty("checkoutSnapshot");
    expect(payment).not.toHaveProperty("rawProviderPayload");
  });

  test("sends only allowlisted verified fields to finalization and failure RPCs", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: databaseRow, error: null }),
    };
    const store = createSupabasePaymentVerificationStore(client);

    await store.finalize(PAYMENT_ID, {
      ...verifiedTransaction,
      rawProviderPayload: { mustNotPersist: true },
    });
    await store.markFailed(PAYMENT_ID, "006");
    await store.recordRejected(PAYMENT_ID, "amount_mismatch", "callback");

    expect(client.rpc).toHaveBeenNthCalledWith(1, "finalize_pelecard_payment", {
      p_payment_id: PAYMENT_ID,
      p_provider_transaction_id: PROVIDER_TRANSACTION_ID,
      p_approval_id: "approval-1",
      p_provider_status_code: "000",
      p_amount: "120.00",
      p_currency: "ILS",
    });
    expect(client.rpc).toHaveBeenNthCalledWith(2, "fail_pelecard_payment", {
      p_payment_id: PAYMENT_ID,
      p_provider_status_code: "006",
      p_failure_code: "provider_declined",
    });
    expect(client.rpc).toHaveBeenNthCalledWith(
      3,
      "record_pelecard_verification_rejection",
      {
        p_payment_id: PAYMENT_ID,
        p_failure_code: "amount_mismatch",
        p_source: "callback",
      },
    );
  });
});

describe("Pelecard Edge entry points", () => {
  const functionPath = (name) => fileURLToPath(new URL(
    `../../../../supabase/functions/${name}/index.ts`,
    import.meta.url,
  ));

  test.each(["pelecard-callback", "pelecard-verify", "pelecard-status"])(
    "ships the %s Edge Function",
    (name) => expect(existsSync(functionPath(name))).toBe(true),
  );

  test("keeps live notification and lookup contracts fail-closed", () => {
    for (const name of ["pelecard-callback", "pelecard-verify"]) {
      const source = readFileSync(functionPath(name), "utf8");
      expect(source).toContain("capability_unconfigured");
      expect(source).not.toMatch(/gateway\d*\.pelecard\.biz/i);
      expect(source).not.toMatch(/console\.(log|error|warn)/);
      expect(source).not.toMatch(/card.?number|cvv|expiry|\bpan\b/i);
    }
  });
});
