import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("rivhit-accounting Edge Function contract", () => {
  test("keeps all credentials and mappings in server environment", () => {
    expect(source).toContain('Deno.env.get("RIVHIT_API_TOKEN")');
    expect(source).toContain('Deno.env.get("RIVHIT_DOCUMENT_TYPE_MAP")');
    expect(source).toContain('Deno.env.get("RIVHIT_ACCOUNTING_MODE")');
    expect(source).not.toMatch(/body\??\.(apiToken|api_token|token)/);
  });

  test("authenticates and authorizes admin or operations", () => {
    expect(source).toContain("auth.getUser()");
    expect(source).toContain('.from("profiles")');
    expect(source).toMatch(/\["admin", "operations"\]\.includes\(callerProfile\.role\)/);
  });

  test("loads order data server-side and composes the accounting workflow", () => {
    expect(source).toContain('.from("orders")');
    expect(source).toContain('.from("activities")');
    expect(source).toContain("new RivhitClient");
    expect(source).toContain("new SupabaseAccountingRepository");
    expect(source).toContain("runRivhitAccounting");
    expect(source).toContain("mapOrderToAccountingSource");
  });

  test("does not couple payment providers or expose a frontend integration", () => {
    expect(source).not.toMatch(/pelecard|icredit/i);
    expect(source).not.toMatch(/VITE_/);
  });
});
