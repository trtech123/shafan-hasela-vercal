import { describe, expect, test, vi } from "vitest";
import { authorizeHandoffStaff } from "../../../supabase/functions/chatbot-handoff-admin/authorization.js";
import { createHandoffAdminHandler } from "../../../supabase/functions/chatbot-handoff-admin/handler.js";

function authClient({ user = { id: "user-1" }, role = "admin", userError = null, profileError = null } = {}) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: userError }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: profileError }),
        }),
      }),
    }),
  };
}

describe("chatbot handoff staff authorization", () => {
  test("rejects requests without a bearer token", async () => {
    const result = await authorizeHandoffStaff({
      request: new Request("https://example.test"),
      supabaseUrl: "https://project.test",
      anonKey: "anon",
      createClientImpl: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  test.each(["admin", "operations"])("allows %s", async (role) => {
    const client = authClient({ role });
    const result = await authorizeHandoffStaff({
      request: new Request("https://example.test", { headers: { Authorization: "Bearer jwt" } }),
      supabaseUrl: "https://project.test",
      anonKey: "anon",
      createClientImpl: vi.fn().mockReturnValue(client),
    });
    expect(result).toMatchObject({ ok: true, userId: "user-1", role });
    expect(result.userClient).toBe(client);
  });

  test.each(["cashier", "instructor"])("rejects %s", async (role) => {
    const result = await authorizeHandoffStaff({
      request: new Request("https://example.test", { headers: { Authorization: "Bearer jwt" } }),
      supabaseUrl: "https://project.test",
      anonKey: "anon",
      createClientImpl: vi.fn().mockReturnValue(authClient({ role })),
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});

describe("chatbot handoff admin handler", () => {
  const handoffId = "00000000-0000-4000-8000-000000000001";

  test.each(["claim", "resume", "resolve", "close"])("executes %s through the controlled operation", async (action) => {
    const operations = { [action]: vi.fn().mockResolvedValue(true) };
    const handler = createHandoffAdminHandler({
      authorize: vi.fn().mockResolvedValue({ ok: true, userId: "user-1", role: "operations" }),
      operations,
    });
    const response = await handler(new Request("https://example.test", {
      method: "POST",
      headers: { Authorization: "Bearer jwt", "content-type": "application/json" },
      body: JSON.stringify({ action, handoffId }),
    }));

    expect(response.status).toBe(200);
    expect(operations[action]).toHaveBeenCalledWith(handoffId, "user-1");
  });

  test("sends a staff reply without accepting a destination", async () => {
    const operations = { reply: vi.fn().mockResolvedValue({ providerMessageId: "wamid.staff.1" }) };
    const handler = createHandoffAdminHandler({
      authorize: vi.fn().mockResolvedValue({ ok: true, userId: "user-1", role: "admin" }),
      operations,
    });
    const response = await handler(new Request("https://example.test", {
      method: "POST",
      headers: { Authorization: "Bearer jwt", "content-type": "application/json" },
      body: JSON.stringify({ action: "reply", handoffId, message: "נחזור אליכם היום", destination: "attacker-number" }),
    }));

    expect(response.status).toBe(200);
    expect(operations.reply).toHaveBeenCalledWith(handoffId, "user-1", "נחזור אליכם היום");
  });

  test("returns conflict when an atomic state change loses the race", async () => {
    const handler = createHandoffAdminHandler({
      authorize: vi.fn().mockResolvedValue({ ok: true, userId: "user-1", role: "admin" }),
      operations: { claim: vi.fn().mockResolvedValue(false) },
    });
    const response = await handler(new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "claim", handoffId }),
    }));
    expect(response.status).toBe(409);
  });

  test("rejects invalid actions, identifiers, and empty replies", async () => {
    const handler = createHandoffAdminHandler({
      authorize: vi.fn().mockResolvedValue({ ok: true, userId: "user-1", role: "admin" }),
      operations: {},
    });
    for (const body of [
      { action: "delete", handoffId },
      { action: "claim", handoffId: "not-a-uuid" },
      { action: "reply", handoffId, message: " " },
    ]) {
      const response = await handler(new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }));
      expect(response.status).toBe(400);
    }
  });
});
