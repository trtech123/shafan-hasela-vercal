import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandoffOperations } from "../../../supabase/functions/chatbot-handoff-admin/operations.js";

describe("handoff operations security contract", () => {
  test("derives the reply destination from the assigned active handoff", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, "../../../supabase/functions/chatbot-handoff-admin/operations.js"), "utf8");

    expect(source).toMatch(/\.eq\("status", "active"\)/);
    expect(source).toMatch(/\.eq\("assigned_to", userId\)/);
    expect(source).toMatch(/external_contact_id/);
    expect(source).not.toMatch(/destination|request\.json|body\.phone/);
    expect(source).not.toMatch(/\.from\(["'](?:orders|quotes|clubs|club_|sales|payment_|accounting_|recurring_)/i);
  });

  test("runs staff state RPCs with the authenticated user client", async () => {
    const serviceSupabase = { rpc: vi.fn() };
    const userSupabase = { rpc: vi.fn().mockResolvedValue({ data: true, error: null }) };
    const operations = createHandoffOperations({ serviceSupabase, sender: {} }).forUser(userSupabase);

    await expect(operations.claim("handoff-1", "user-1")).resolves.toBe(true);
    expect(userSupabase.rpc).toHaveBeenCalledWith("claim_bot_handoff", { p_handoff_id: "handoff-1" });
    expect(serviceSupabase.rpc).not.toHaveBeenCalled();
  });
});
