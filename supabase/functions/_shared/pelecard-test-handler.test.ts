import { expect, test, vi } from "vitest";
import { createPelecardTestHandler, createPelecardTestFeedbackHandler } from "./pelecard-test-handler.ts";
import { readFileSync } from "node:fs";

const id = "a0000000-0000-4000-8000-000000000001";
const tx = "1a111c-1d1f6g-9h8j"; // Documented opaque Pelecard identifier.
const request = (body: unknown) => new Request("https://edge.test/pelecard-test", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-session" }, body: JSON.stringify(body),
});
const fixture = () => {
  const row = { id, status: "pending", amount_minor: 100, confirmation_key: "server-only-key", redirect_url: "https://gateway20.pelecard.biz/test", provider_transaction_id: null };
  const store = { get: vi.fn(async () => row), reserve: vi.fn(async () => true), initiated: vi.fn(), verified: vi.fn() };
  const provider = { preflight: vi.fn(async () => ({ authenticated: true })), initiate: vi.fn(async () => ({ redirectUrl: row.redirect_url, confirmationKey: row.confirmation_key })), verify: vi.fn(async () => ({ status: "test_verified", transactionId: tx, apiStatus: "000", transactionStatus: "000" })) };
  const env: Record<string, string> = { PELECARD_MODE: "test", PELECARD_TEST_TRANSACTION_ENABLED: "false" };
  const dependencies = { read: (key: string) => env[key], auth: { authenticate: vi.fn(async () => ({ id, role: "admin" })) }, store, provider: () => provider, allowedOrigins: ["https://app.test"], feedbackUrl: "https://edge.test/pelecard-test-feedback" };
  return { row, store, provider, env, dependencies };
};
test("disabled initiation never creates a record or reads credentials/calls a provider", async () => {
  const f = fixture();
  const result = await createPelecardTestHandler(f.dependencies)(request({ action: "initiate", testPaymentId: id }));
  expect(result.status).toBe(503);
  expect(f.store.reserve).not.toHaveBeenCalled();
  expect(f.provider.initiate).not.toHaveBeenCalled();
});
test.each(["cashier", "operations", "instructor"])("%s cannot access TEST operations", async (role) => {
  const f = fixture(); f.dependencies.auth.authenticate.mockResolvedValue({ id, role });
  const result = await createPelecardTestHandler(f.dependencies)(request({ action: "preflight" }));
  expect(result.status).toBe(403); expect(f.provider.preflight).not.toHaveBeenCalled();
});
test("preflight can authenticate without creating a transaction or DB record", async () => {
  const f = fixture();
  const result = await createPelecardTestHandler(f.dependencies)(request({ action: "preflight" }));
  expect(await result.json()).toEqual({ mode: "test", authenticated: true, transactionCreated: false });
  expect(f.store.reserve).not.toHaveBeenCalled();
});
test.each(["orderId", "order_id", "amount", "terminal", "password", "mode"])("rejects injected %s", async (field) => {
  const f = fixture(); f.env.PELECARD_TEST_TRANSACTION_ENABLED = "true";
  const result = await createPelecardTestHandler(f.dependencies)(request({ action: "initiate", testPaymentId: id, [field]: "untrusted" }));
  expect(result.status).toBe(400); expect(f.store.reserve).not.toHaveBeenCalled();
});
test("duplicate initialization cannot create another provider session", async () => {
  const f = fixture(); f.env.PELECARD_TEST_TRANSACTION_ENABLED = "true"; f.store.reserve.mockResolvedValue(false);
  const result = await createPelecardTestHandler(f.dependencies)(request({ action: "initiate", testPaymentId: id }));
  expect(result.status).toBe(409); expect(f.provider.initiate).not.toHaveBeenCalled();
});
test("initialization exposes only TEST identity and hosted URL", async () => {
  const f = fixture(); f.env.PELECARD_TEST_TRANSACTION_ENABLED = "true";
  const result = await createPelecardTestHandler(f.dependencies)(request({ action: "initiate", testPaymentId: id }));
  expect(await result.json()).toEqual({ mode: "test", testPaymentId: id, status: "pending", redirectUrl: f.row.redirect_url, commercialEffect: false });
  expect(f.store.initiated).toHaveBeenCalledWith(id, { redirectUrl: f.row.redirect_url, confirmationKey: f.row.confirmation_key });
});
test("browser return does not read/write DB or verify anything", async () => {
  const f = fixture();
  const result = await createPelecardTestFeedbackHandler(f.dependencies)(new Request(`https://edge.test/feedback?return=1&testPaymentId=${id}&PelecardStatusCode=000`));
  expect(result.status).toBe(200); expect(f.store.get).not.toHaveBeenCalled(); expect(f.provider.verify).not.toHaveBeenCalled();
  expect(await result.text()).toContain("not proof of payment");
});
test("forged callback status and confirmation cannot finalize TEST", async () => {
  const f = fixture();
  const r = new Request(`https://edge.test/feedback?testPaymentId=${id}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ testResult: JSON.stringify({ PelecardStatusCode: "000", PelecardTransactionId: tx, ConfirmationKey: "forged" }) }) });
  const result = await createPelecardTestFeedbackHandler(f.dependencies)(r);
  expect(result.status).toBe(400); expect(f.provider.verify).not.toHaveBeenCalled(); expect(f.store.verified).not.toHaveBeenCalled();
});
test("callback uses authoritative evidence and stores only a TEST result", async () => {
  const f = fixture();
  const r = new Request(`https://edge.test/feedback?testPaymentId=${id}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ testResult: JSON.stringify({ PelecardStatusCode: "00", PelecardTransactionId: tx, ConfirmationKey: f.row.confirmation_key }) }) });
  const result = await createPelecardTestFeedbackHandler(f.dependencies)(r);
  expect(result.status).toBe(200);
  expect(f.provider.verify).toHaveBeenCalledWith({ id, amountMinor: 100, confirmationKey: f.row.confirmation_key, transactionId: tx });
  expect(f.store.verified).toHaveBeenCalledOnce();
  expect(await result.json()).toEqual({ mode: "test", testPaymentId: id, status: "test_verified", commercialEffect: false });
});
test("lookup failure cannot mark TEST verified or expose error text", async () => {
  const f = fixture(); f.provider.verify.mockRejectedValue(new Error("sensitive provider body"));
  const result = await createPelecardTestHandler(f.dependencies)(request({ action: "verify", testPaymentId: id, transactionId: tx }));
  expect(result.status).toBe(502); expect(f.store.verified).not.toHaveBeenCalled(); expect(await result.text()).not.toContain("sensitive");
});
test("commercial handlers block before credentials/runtime are constructed", () => {
  for (const slug of ["pelecard-initiate", "pelecard-callback", "pelecard-verify", "pelecard-refund"]) {
    const source = readFileSync(new URL(`../${slug}/index.ts`, import.meta.url), "utf8");
    const guard = source.indexOf("assertCommercialPaymentsDisabled();");
    expect(guard).toBeGreaterThan(0);
    const runtime = source.indexOf(slug === "pelecard-initiate" ? 'requireEnv("SUPABASE_URL")' : "const runtime = create");
    expect(guard).toBeLessThan(runtime);
  }
});
test("TEST modules have no commercial store, finalization, accounting, or LIVE secret imports", () => {
  for (const file of ["pelecard-test-handler.ts", "pelecard-test-runtime.ts", "pelecard-test-store.ts", "pelecard-test-provider.ts", "pelecard-test-config.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).not.toMatch(/finalize_pelecard_payment|createPaymentAccountingRuntime|payment-accounting\/|rivhit\/|["'](?:orders|sales|payment_transactions)["']/);
    expect(source).not.toMatch(/["']PELECARD_(?:USER|PASSWORD|TERMINAL)["']|console\./);
  }
});
