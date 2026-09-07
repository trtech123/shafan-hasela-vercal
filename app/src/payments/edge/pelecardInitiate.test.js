import { describe, expect, test, vi } from "vitest";

import {
  createPelecardInitiateHandler,
} from "../../../../supabase/functions/_shared/payment-initiation.ts";
import {
  parsePaymentJson,
} from "../../../../supabase/functions/_shared/payment-http.ts";
import {
  createSupabasePaymentStore,
} from "../../../../supabase/functions/_shared/payment-store.ts";
import { PaymentError } from "../../../../supabase/functions/_shared/payment-types.ts";

const PAYMENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const REDIRECT_URL =
  "https://gateway20.pelecard.biz/PaymentGW/?session=hosted-fixture";

const checkout = {
  schema_version: 1,
  items: [
    { id: "activity-1", name: "Climbing", qty: 2, customPrice: 49.95 },
    { id: "activity-2", name: "Ropes", qty: 1, customPrice: 25.1 },
  ],
  discount: {
    type: "staff",
    mode: "fixed",
    value: 5,
    original_total: 125,
    final_total: 120,
  },
  linked_order_info: {
    order_number: "ORD-101",
    client_name: "Test Customer",
    client_phone: "0500000000",
    organization: "",
  },
  sale_date: "2026-09-08",
};

const requestBody = {
  idempotencyKey: "attempt-0001",
  orderId: ORDER_ID,
  checkout,
};

function jsonRequest(body = requestBody, options = {}) {
  const headers = new Headers({
    Authorization: "Bearer test-jwt",
    "Content-Type": "application/json",
    Origin: "https://app.example.test",
    ...(options.headers ?? {}),
  });
  return new Request("https://edge.example.test/pelecard-initiate", {
    method: options.method ?? "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(body),
  });
}

function createMemoryStore() {
  const byKey = new Map();
  return {
    reserve: vi.fn(async (input) => {
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return { created: false, payment: { ...existing } };
      const payment = {
        id: input.proposedPaymentId,
        provider: "pelecard",
        orderId: input.orderId,
        createdBy: input.createdBy,
        idempotencyKey: input.idempotencyKey,
        amountMinor: input.amountMinor,
        currencyCode: input.currencyCode,
        checkoutSnapshot: input.checkoutSnapshot,
        merchantCorrelation: input.proposedPaymentId,
        status: "initiated",
      };
      byKey.set(input.idempotencyKey, payment);
      return { created: true, payment: { ...payment } };
    }),
    saveHostedSession: vi.fn(async (paymentId, session) => {
      const payment = [...byKey.values()].find((item) => item.id === paymentId);
      Object.assign(payment, {
        status: "pending_provider",
        providerSessionId: session.sessionReference,
        redirectUrl: session.redirectUrl,
      });
      return { ...payment };
    }),
    markInitiationUncertain: vi.fn(async (paymentId, failureCode) => {
      const payment = [...byKey.values()].find((item) => item.id === paymentId);
      Object.assign(payment, { status: "timed_out", failureCode });
      return { ...payment };
    }),
  };
}

function createDependencies(overrides = {}) {
  const store = overrides.store ?? createMemoryStore();
  const provider = overrides.provider ?? {
    initiate: vi.fn().mockResolvedValue({
      redirectUrl: REDIRECT_URL,
      sessionReference: "hosted-session-fixture",
    }),
  };
  const auth = overrides.auth ?? {
    authenticate: vi.fn().mockResolvedValue({ id: USER_ID, role: "cashier" }),
  };

  return {
    dependencies: {
      auth,
      store,
      provider,
      createPaymentId: () => PAYMENT_ID,
      config: {
        allowedAppOrigins: ["https://app.example.test"],
        allowedProviderRedirectOrigins: ["https://gateway20.pelecard.biz"],
        returnUrl: "https://app.example.test/payment/return",
        callbackUrl: "https://edge.example.test/pelecard-callback",
        currencyCode: "ILS",
        maxBodyBytes: 32_768,
      },
    },
    auth,
    store,
    provider,
  };
}

async function invoke(request, overrides = {}) {
  const context = createDependencies(overrides);
  const response = await createPelecardInitiateHandler(context.dependencies)(request);
  return { context, response, body: await response.json() };
}

describe("Pelecard initiation handler", () => {
  test("rejects a missing bearer token before store or provider access", async () => {
    const auth = { authenticate: vi.fn() };
    const store = createMemoryStore();
    const provider = { initiate: vi.fn() };
    const request = jsonRequest(requestBody, {
      headers: { Authorization: "" },
    });

    const { response, body } = await invoke(request, { auth, store, provider });

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: { code: "missing_authorization" } });
    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(store.reserve).not.toHaveBeenCalled();
    expect(provider.initiate).not.toHaveBeenCalled();
  });

  test("rejects an invalid JWT before privileged access", async () => {
    const auth = { authenticate: vi.fn().mockResolvedValue(null) };
    const store = createMemoryStore();
    const provider = { initiate: vi.fn() };

    const { response, body } = await invoke(jsonRequest(), { auth, store, provider });

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: { code: "invalid_session" } });
    expect(auth.authenticate).toHaveBeenCalledWith("test-jwt");
    expect(store.reserve).not.toHaveBeenCalled();
    expect(provider.initiate).not.toHaveBeenCalled();
  });

  test("rejects instructors before privileged access", async () => {
    const auth = {
      authenticate: vi.fn().mockResolvedValue({ id: USER_ID, role: "instructor" }),
    };
    const store = createMemoryStore();
    const provider = { initiate: vi.fn() };

    const { response, body } = await invoke(jsonRequest(), { auth, store, provider });

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: { code: "forbidden" } });
    expect(store.reserve).not.toHaveBeenCalled();
    expect(provider.initiate).not.toHaveBeenCalled();
  });

  test.each(["admin", "operations", "cashier"])(
    "allows the %s role",
    async (role) => {
      const auth = {
        authenticate: vi.fn().mockResolvedValue({ id: USER_ID, role }),
      };

      const { response } = await invoke(jsonRequest(), { auth });

      expect(response.status).toBe(201);
    },
  );

  test("rejects malformed JSON and an oversized body", async () => {
    const malformed = await invoke(jsonRequest(undefined, { rawBody: "{" }));
    expect(malformed.response.status).toBe(400);
    expect(malformed.body).toEqual({ error: { code: "invalid_json" } });
    expect(malformed.context.store.reserve).not.toHaveBeenCalled();

    const oversized = await invoke(jsonRequest(undefined, {
      rawBody: JSON.stringify({ padding: "x".repeat(33_000) }),
    }));
    expect(oversized.response.status).toBe(413);
    expect(oversized.body).toEqual({ error: { code: "body_too_large" } });
    expect(oversized.context.store.reserve).not.toHaveBeenCalled();
  });

  test.each([
    [{ ...requestBody, idempotencyKey: "short" }, "invalid_input"],
    [{ ...requestBody, orderId: "not-a-uuid" }, "invalid_input"],
    [{ ...requestBody, checkout: { ...checkout, items: [] } }, "invalid_input"],
    [{ ...requestBody, checkout: { ...checkout, cardNumber: "not-accepted" } }, "invalid_input"],
    [{
      ...requestBody,
      checkout: {
        ...checkout,
        items: [{ ...checkout.items[0], cvv: "not-accepted" }],
      },
    }, "invalid_input"],
    [{
      ...requestBody,
      checkout: {
        ...checkout,
        discount: { ...checkout.discount, final_total: 119.99 },
      },
    }, "invalid_input"],
    [{
      ...requestBody,
      checkout: {
        ...checkout,
        items: [{ ...checkout.items[0], customPrice: 10.001 }],
      },
    }, "invalid_input"],
  ])("rejects invalid request or checkout input %#", async (body, code) => {
    const result = await invoke(jsonRequest(body));

    expect(result.response.status).toBe(400);
    expect(result.body).toEqual({ error: { code } });
    expect(result.context.store.reserve).not.toHaveBeenCalled();
    expect(result.context.provider.initiate).not.toHaveBeenCalled();
  });

  test("derives the exact integer-agorot total server-side", async () => {
    const { context, response } = await invoke(jsonRequest());

    expect(response.status).toBe(201);
    expect(context.store.reserve).toHaveBeenCalledWith(expect.objectContaining({
      amountMinor: 12_000,
      currencyCode: "ILS",
      checkoutSnapshot: checkout,
    }));
    expect(context.provider.initiate).toHaveBeenCalledWith({
      amountMinor: 12_000,
      currencyCode: "ILS",
      merchantKey: PAYMENT_ID,
      returnUrl: "https://app.example.test/payment/return",
      callbackUrl: "https://edge.example.test/pelecard-callback",
    });
  });

  test("accepts a standalone checkout when orderId is omitted", async () => {
    const { orderId: _orderId, ...standaloneRequest } = requestBody;

    const { context, response } = await invoke(jsonRequest(standaloneRequest));

    expect(response.status).toBe(201);
    expect(context.store.reserve).toHaveBeenCalledWith(expect.objectContaining({
      orderId: null,
    }));
  });

  test("returns the same completed result for an identical duplicate without a second provider call", async () => {
    const context = createDependencies();
    const handler = createPelecardInitiateHandler(context.dependencies);

    const first = await handler(jsonRequest());
    const second = await handler(jsonRequest());

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      paymentId: PAYMENT_ID,
      status: "pending_provider",
      redirectUrl: REDIRECT_URL,
    });
    expect(context.provider.initiate).toHaveBeenCalledOnce();
  });

  test.each([
    "initiated",
    "pending_provider",
    "succeeded",
    "failed",
    "timed_out",
    "refund_pending",
    "refunded",
    "void_pending",
    "voided",
  ])("returns an existing %s ledger attempt without another provider call", async (status) => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        created: false,
        id: PAYMENT_ID,
        provider: "pelecard",
        order_id: ORDER_ID,
        created_by: USER_ID,
        idempotency_key: requestBody.idempotencyKey,
        amount: "120.00",
        currency: "ILS",
        checkout_snapshot: checkout,
        status,
        provider_session_id: status === "pending_provider"
          ? "hosted-session-fixture"
          : null,
        provider_redirect_url: status === "pending_provider" ? REDIRECT_URL : null,
        failure_code: null,
      },
      error: null,
    });
    const store = createSupabasePaymentStore({ rpc });
    const provider = { initiate: vi.fn() };

    const { response, body } = await invoke(jsonRequest(), { store, provider });

    expect(response.status).toBe(status === "pending_provider" ? 200 : 202);
    expect(body).toEqual(status === "pending_provider"
      ? { paymentId: PAYMENT_ID, status, redirectUrl: REDIRECT_URL }
      : { paymentId: PAYMENT_ID, status });
    expect(provider.initiate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
  });

  test("does not return a corrupt stored redirect on an idempotent retry", async () => {
    const baseStore = createMemoryStore();
    await baseStore.reserve({
      proposedPaymentId: PAYMENT_ID,
      orderId: ORDER_ID,
      createdBy: USER_ID,
      idempotencyKey: requestBody.idempotencyKey,
      amountMinor: 12_000,
      currencyCode: "ILS",
      checkoutSnapshot: checkout,
    });
    await baseStore.saveHostedSession(PAYMENT_ID, {
      redirectUrl: "https://evil.example/collect",
      sessionReference: "corrupt-session",
    });
    const provider = { initiate: vi.fn() };

    const { response, body } = await invoke(jsonRequest(), {
      store: baseStore,
      provider,
    });

    expect(response.status).toBe(202);
    expect(body).toEqual({ paymentId: PAYMENT_ID, status: "pending_provider" });
    expect(provider.initiate).not.toHaveBeenCalled();
  });

  test.each([
    [{ ...requestBody, orderId: null }],
    [{
      ...requestBody,
      checkout: {
        ...checkout,
        items: [{ ...checkout.items[0], customPrice: 50 }],
        discount: null,
      },
    }],
  ])("rejects changed immutable input for a reused key", async (changedBody) => {
    const context = createDependencies();
    const handler = createPelecardInitiateHandler(context.dependencies);
    await handler(jsonRequest());

    const response = await handler(jsonRequest(changedBody));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "idempotency_conflict" } });
    expect(context.provider.initiate).toHaveBeenCalledOnce();
  });

  test("lets only the reservation creator initialize the provider during concurrent duplicates", async () => {
    const context = createDependencies();
    const handler = createPelecardInitiateHandler(context.dependencies);

    const [first, second] = await Promise.all([
      handler(jsonRequest()),
      handler(jsonRequest()),
    ]);
    const bodies = await Promise.all([first.json(), second.json()]);

    expect(context.provider.initiate).toHaveBeenCalledOnce();
    expect(bodies.every((body) => body.paymentId === PAYMENT_ID)).toBe(true);
    expect([first.status, second.status].sort()).toEqual([201, 202]);
  });

  test.each([
    ["provider_timeout", 504],
    ["provider_unavailable", 503],
  ])("keeps %s initiation uncertain and never retries it automatically", async (code, status) => {
    const provider = {
      initiate: vi.fn().mockRejectedValue(new PaymentError(code)),
    };
    const context = createDependencies({ provider });
    const handler = createPelecardInitiateHandler(context.dependencies);

    const first = await handler(jsonRequest());
    const second = await handler(jsonRequest());

    expect(first.status).toBe(status);
    expect(await first.json()).toEqual({ error: { code }, paymentId: PAYMENT_ID });
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({
      paymentId: PAYMENT_ID,
      status: "timed_out",
    });
    expect(context.store.markInitiationUncertain).toHaveBeenCalledWith(
      PAYMENT_ID,
      code,
    );
    expect(provider.initiate).toHaveBeenCalledOnce();
  });

  test("marks an invalid hosted redirect result uncertain without exposing it", async () => {
    const provider = {
      initiate: vi.fn().mockResolvedValue({
        redirectUrl: "https://evil.example/collect",
        sessionReference: "hosted-session-fixture",
        raw: "must-not-escape",
      }),
    };

    const result = await invoke(jsonRequest(), { provider });

    expect(result.response.status).toBe(502);
    expect(result.body).toEqual({
      error: { code: "invalid_provider_response" },
      paymentId: PAYMENT_ID,
    });
    expect(result.context.store.markInitiationUncertain).toHaveBeenCalledWith(
      PAYMENT_ID,
      "invalid_provider_response",
    );
  });

  test("returns only the sanitized hosted payment response", async () => {
    const { response, body } = await invoke(jsonRequest());

    expect(response.status).toBe(201);
    expect(body).toEqual({
      paymentId: PAYMENT_ID,
      status: "pending_provider",
      redirectUrl: REDIRECT_URL,
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.test",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  test("rejects an unconfigured browser origin without wildcard CORS", async () => {
    const result = await invoke(jsonRequest(requestBody, {
      headers: { Origin: "https://evil.example" },
    }));

    expect(result.response.status).toBe(403);
    expect(result.body).toEqual({ error: { code: "origin_forbidden" } });
    expect(result.response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(result.context.auth.authenticate).not.toHaveBeenCalled();
    expect(result.context.store.reserve).not.toHaveBeenCalled();
  });
});

describe("bounded payment JSON parsing", () => {
  function streamedRequest(chunks, onCancel) {
    let index = 0;
    return new Request("https://edge.example.test/pelecard-initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new ReadableStream({
        pull(controller) {
          if (index >= chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(chunks[index++]);
        },
        cancel: onCancel,
      }),
      duplex: "half",
    });
  }

  test("cancels a chunked body as soon as its byte limit is exceeded", async () => {
    const cancel = vi.fn();
    const chunks = Array.from(
      { length: 100 },
      () => new Uint8Array(8).fill("x".charCodeAt(0)),
    );
    const request = streamedRequest(chunks, cancel);

    await expect(parsePaymentJson(request, 10)).rejects.toMatchObject({
      status: 413,
      code: "body_too_large",
    });

    expect(request.headers.get("Content-Length")).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("still returns the safe size error when stream cancellation rejects", async () => {
    const request = streamedRequest(
      [new Uint8Array(11)],
      vi.fn().mockRejectedValue(new Error("transport detail")),
    );

    await expect(parsePaymentJson(request, 10)).rejects.toMatchObject({
      status: 413,
      code: "body_too_large",
    });
  });

  test("counts valid multibyte JSON by bytes", async () => {
    const encoded = new TextEncoder().encode(JSON.stringify({ name: "שלום" }));
    const accepted = streamedRequest([encoded], vi.fn());
    const rejected = streamedRequest([encoded], vi.fn());

    await expect(parsePaymentJson(accepted, encoded.byteLength)).resolves.toEqual({
      name: "שלום",
    });
    await expect(parsePaymentJson(rejected, encoded.byteLength - 1)).rejects
      .toMatchObject({ status: 413, code: "body_too_large" });
  });

  test.each(["", "{"])("safely rejects empty or malformed JSON", async (raw) => {
    const request = streamedRequest([new TextEncoder().encode(raw)], vi.fn());

    await expect(parsePaymentJson(request, 100)).rejects.toMatchObject({
      status: 400,
      code: "invalid_json",
    });
  });
});
