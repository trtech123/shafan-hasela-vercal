import { expect, test, vi } from "vitest";
import { createTestPreflightHandler } from "./pelecard-test-preflight.ts";
const key = "synthetic-ephemeral-probe-key-".repeat(3);
test.each(["missing", "wrong", "expired", "excessive", "live", "GET"])("preflight rejects %s without provider access", async (scenario) => {
  const now = 1000000;
  const env: Record<string,string> = { PELECARD_MODE: scenario === "live" ? "live" : "test", PELECARD_TEST_PREFLIGHT_KEY: key, PELECARD_TEST_PREFLIGHT_EXPIRES: String(now + (scenario === "expired" ? -1 : scenario === "excessive" ? 1000000 : 600000)) };
  const preflight = vi.fn(async () => ({ authenticated: true as const }));
  const response = await createTestPreflightHandler({ read: (k) => env[k], preflight, now: () => now })(new Request("https://edge.test/preflight", { method: scenario === "GET" ? "GET" : "POST", headers: scenario === "missing" ? {} : { Authorization: `Bearer ${scenario === "wrong" ? "wrong" : key}` } }));
  expect(response.status).toBeGreaterThanOrEqual(400); expect(preflight).not.toHaveBeenCalled();
});
test("authorized probe returns booleans only", async () => {
  const env: Record<string,string> = { PELECARD_MODE: "test", PELECARD_TEST_PREFLIGHT_KEY: key, PELECARD_TEST_PREFLIGHT_EXPIRES: "1600000" };
  const preflight = vi.fn(async () => ({ authenticated: true as const }));
  const response = await createTestPreflightHandler({ read: (k) => env[k], preflight, now: () => 1000000 })(new Request("https://edge.test/preflight", { method: "POST", headers: { Authorization: `Bearer ${key}` } }));
  expect(await response.json()).toEqual({ mode: "test", authenticated: true, transactionCreated: false });
  expect(preflight).toHaveBeenCalledOnce();
});
