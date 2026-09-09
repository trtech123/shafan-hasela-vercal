import { describe, expect, test, vi } from "vitest";
import { createPaymentAccountingWorkerHandler } from "./worker-handler.ts";

const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function auth(role: string | null) {
  return {
    authenticate: vi.fn().mockResolvedValue(
      role ? { id: "11111111-1111-4111-8111-111111111111", role } : null,
    ),
  };
}

function request(
  body: unknown,
  token = "valid-token",
  overrides: { method?: string; origin?: string; contentType?: string } = {},
) {
  const headers = new Headers({
    "Content-Type": overrides.contentType ?? "application/json",
    Origin: overrides.origin ?? "https://app.example.test",
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const method = overrides.method ?? "POST";
  return new Request("https://edge.example.test/payment-accounting-worker", {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" || method === "OPTIONS"
      ? {}
      : { body: JSON.stringify(body) }),
  });
}

function handler(role: string | null, processEvent = vi.fn().mockResolvedValue({
  eventId,
  status: "succeeded",
  claimed: true,
  duplicate: false,
  retryAfter: null,
  documentId: "doc-id",
  documentNumber: "42",
  documentUrl: "https://api.rivhit.co.il/pdf/test",
})) {
  return {
    processEvent,
    handle: createPaymentAccountingWorkerHandler({
      auth: auth(role),
      processEvent,
      allowedAppOrigins: ["https://app.example.test"],
      maxBodyBytes: 4096,
    }),
  };
}

describe("payment accounting worker handler", () => {
  test.each(["admin", "operations"])("allows %s to process an event", async (role) => {
    const context = handler(role);
    const response = await context.handle(request({ eventId }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "succeeded",
      documentNumber: "42",
    });
    expect(context.processEvent).toHaveBeenCalledWith(eventId, false);
  });

  test.each([
    ["cashier", "valid-token", 403],
    ["instructor", "valid-token", 403],
    [null, "valid-token", 401],
    [null, "", 401],
  ])("denies role/session %s", async (role, token, status) => {
    const context = handler(role);
    const response = await context.handle(request({ eventId }, token));
    expect(response.status).toBe(status);
    expect(context.processEvent).not.toHaveBeenCalled();
  });

  test.each([
    {},
    { eventId: "not-a-uuid" },
    { eventId, forceRetry: "yes" },
    { eventId, forceRetry: false, sourceId: "attacker-source" },
    { eventId, amount: 1 },
    { eventId, paymentStatus: "failed" },
    { eventId, documentType: 999 },
  ])("rejects non-exact worker input %#", async (body) => {
    const context = handler("admin");
    const response = await context.handle(request(body));
    expect(response.status).toBe(400);
    expect(context.processEvent).not.toHaveBeenCalled();
  });

  test("passes force retry only as backend claim intent", async () => {
    const context = handler("operations");
    const response = await context.handle(request({ eventId, forceRetry: true }));
    expect(response.status).toBe(200);
    expect(context.processEvent).toHaveBeenCalledWith(eventId, true);
  });

  test("returns duplicate claim state without exposing an error payload", async () => {
    const processEvent = vi.fn().mockResolvedValue({
      eventId,
      status: "retryable_error",
      claimed: false,
      duplicate: true,
      retryAfter: "2026-09-09T10:10:00.000Z",
    });
    const context = handler("admin", processEvent);

    const response = await context.handle(request({ eventId }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      ok: true,
      eventId,
      status: "retryable_error",
      claimed: false,
      duplicate: true,
      retryAfter: "2026-09-09T10:10:00.000Z",
    });
    expect(body).not.toHaveProperty("error");
  });

  test.each([
    ["succeeded", 200],
    ["retryable_error", 202],
    ["configuration_required", 202],
    ["permanent_error", 409],
    ["reconciliation_required", 409],
  ])("returns a sanitized response for %s", async (status, expectedStatus) => {
    const processEvent = vi.fn().mockResolvedValue({
      eventId,
      status,
      claimed: true,
      duplicate: false,
      retryAfter: null,
    });
    const response = await handler("admin", processEvent).handle(request({ eventId }));

    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({
      ok: true,
      eventId,
      status,
      claimed: true,
      duplicate: false,
      retryAfter: null,
    });
  });

  test("returns an explicit not-found error when no durable event exists", async () => {
    const processEvent = vi.fn().mockResolvedValue({
      eventId,
      status: null,
      claimed: false,
      duplicate: true,
      retryAfter: null,
    });
    const response = await handler("admin", processEvent).handle(request({ eventId }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test("handles OPTIONS without authentication and rejects other methods", async () => {
    const context = handler("admin");
    const optionsResponse = await context.handle(request({}, "", { method: "OPTIONS" }));
    const getResponse = await context.handle(request({}, "valid-token", { method: "GET" }));

    expect(optionsResponse.status).toBe(204);
    expect(optionsResponse.headers.get("Access-Control-Allow-Origin"))
      .toBe("https://app.example.test");
    expect(getResponse.status).toBe(405);
    expect(context.processEvent).not.toHaveBeenCalled();
  });

  test("rejects a disallowed browser origin", async () => {
    const context = handler("admin");
    const response = await context.handle(request(
      { eventId },
      "valid-token",
      { origin: "https://attacker.example" },
    ));
    expect(response.status).toBe(403);
    expect(context.processEvent).not.toHaveBeenCalled();
  });

  test("rejects unsupported media and oversized bodies", async () => {
    const context = handler("admin");
    const mediaResponse = await context.handle(request(
      { eventId },
      "valid-token",
      { contentType: "text/plain" },
    ));
    const largeBody = { eventId, padding: "x".repeat(4096) };
    const sizeResponse = await context.handle(request(largeBody));

    expect(mediaResponse.status).toBe(415);
    expect(sizeResponse.status).toBe(413);
    expect(context.processEvent).not.toHaveBeenCalled();
  });
});
