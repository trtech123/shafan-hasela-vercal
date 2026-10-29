import { describe, expect, test, vi } from "vitest";
import { createCommercialPaymentHandler } from "./pelecard-commercial.ts";

const orderId = "a0000000-0000-4000-8000-000000000001";
const actorId = "88888888-8888-4888-8888-888888888888";

function handlerFor(role: string) {
  const view = vi.fn(async () => ({
    order_id: orderId, order_number: "NEW-1", amount: 118,
    payment_status: "לא שולם", order_status: "פתוח",
    payment_id: null, payment_state: null, payment_amount: null,
    payment_currency: null, sale_id: null, provider_session_id: null,
    provider_redirect_url: null, controlled: false, accounting_held: false,
    init_enabled: true, hosted_state: "unknown", can_replace: false,
    billing_defaults: { kind: "person", name: "", identity: "", email: "" },
  }));
  const reserve = vi.fn(async () => ({ id: "c0000000-0000-4000-8000-000000000001", created: true }));
  const call = vi.fn(async () => undefined);
  const handler = createCommercialPaymentHandler({
    read: () => "true", allowedOrigins: ["https://example.org"], log: () => {},
    auth: { authenticate: async () => ({ id: actorId, role }) },
    view, reserve, get: vi.fn(), observe: vi.fn(), finalize: vi.fn(), call,
  });
  return { handler, view, reserve, call };
}

async function status(handler: ReturnType<typeof handlerFor>["handler"], token = "valid") {
  return handler(new Request("https://example.org/payment", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status", orderId }),
  }));
}

describe("commercial order payment permissions", () => {
  test.each(["admin", "cashier"])("%s may read their order payment status", async role => {
    const { handler, view } = handlerFor(role);
    expect((await status(handler)).status).toBe(200);
    expect(view).toHaveBeenCalledWith(orderId, actorId);
  });

  test.each(["operations", "instructor"])("%s cannot call the payment function", async role => {
    const { handler, view, reserve } = handlerFor(role);
    expect((await status(handler)).status).toBe(403);
    expect(view).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  test("missing authorization cannot reach payment data", async () => {
    const { handler, view } = handlerFor("cashier");
    const response = await handler(new Request("https://example.org/payment", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", orderId }) }));
    expect(response.status).toBe(401);
    expect(view).not.toHaveBeenCalled();
  });

  test.each(["admin", "cashier"])("%s can reserve with an empty billing identity", async role => {
    const { handler, reserve, call } = handlerFor(role);
    await handler(new Request("https://example.org/payment", {
      method: "POST", headers: { Authorization: "Bearer valid", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "initialize", orderId, expectedAmountMinor: 11800,
        previousPaymentId: null, billing: { kind: "person", name: "Test", identity: "", email: "test@example.org" } }),
    }));
    expect(reserve).toHaveBeenCalledWith(orderId, actorId, 11800, null,
      { kind: "person", name: "Test", identity: "", email: "test@example.org" });
    expect(call).toHaveBeenCalledWith("init", "c0000000-0000-4000-8000-000000000001");
  });
});
