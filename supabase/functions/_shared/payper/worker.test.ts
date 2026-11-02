import { describe, expect, test, vi } from "vitest";
import { runPayperIssuanceBatch, createPayperWorkerHandler } from "./worker.ts";

describe("supervised Payper worker", () => {
  test("only processes the explicitly targeted ledger candidate", async () => {
    const list = vi.fn(async () => ["new-1"]);
    const issue = vi.fn(async () => ({ state: "succeeded" as const }));
    expect(await runPayperIssuanceBatch({ targetPaymentId: "new-1", listCandidates: list, issue })).toEqual({ processed: 1, succeeded: 1, held: 0 });
    expect(issue).toHaveBeenCalledWith("new-1");
  });
  test("uncertain outcome is held and not retried in the same batch", async () => {
    const issue = vi.fn(async () => ({ state: "reconciliation_required" as const }));
    expect(await runPayperIssuanceBatch({ targetPaymentId: "new-1", listCandidates: async () => ["new-1", "new-1"], issue })).toEqual({ processed: 1, succeeded: 0, held: 1 });
    expect(issue).toHaveBeenCalledTimes(1);
  });
  test("pre-dispatch failure is durably blocked for manual review", async () => {
    const holdFailure = vi.fn(async () => undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runPayperIssuanceBatch({ targetPaymentId: "new-1", listCandidates: async () => ["new-1"],
      issue: async () => { throw new Error("private database detail"); }, holdFailure })).toEqual({ processed: 1, succeeded: 0, held: 1 });
    expect(holdFailure).toHaveBeenCalledWith("new-1", "pre_dispatch_review_required");
    expect(log.mock.calls.flat().join(" ")).not.toContain("private database detail");
    log.mockRestore();
  });
  test("persists only the allowlisted provider credential failure code", async () => {
    const holdFailure = vi.fn(async () => undefined);
    await runPayperIssuanceBatch({ targetPaymentId: "new-1", listCandidates: async () => ["new-1"],
      issue: async () => { throw new Error("provider_credentials_rejected"); }, holdFailure });
    expect(holdFailure).toHaveBeenCalledWith("new-1", "provider_credentials_rejected");
  });
  test("quota exhaustion leaves another valid payment eligible for a later authorized release", async () => {
    const holdFailure = vi.fn(async () => undefined);
    await runPayperIssuanceBatch({ targetPaymentId: "new-2", listCandidates: async () => ["new-2"],
      issue: async () => { throw new Error("payper_dispatch_limit_reached"); }, holdFailure });
    expect(holdFailure).not.toHaveBeenCalled();
  });
  test("requires a server token and rejects caller supplied work", async () => {
    const run = vi.fn(async () => ({ processed: 0, succeeded: 0, held: 0 }));
    const handler = createPayperWorkerHandler("private-token-long-1", run);
    expect((await handler(new Request("https://local.test", { method: "POST", headers: { Authorization: "Bearer wrong" } }))).status).toBe(401);
    expect((await handler(new Request("https://local.test", { method: "POST", headers: { Authorization: "Bearer private-token-long-1" }, body: "{\"paymentId\":\"old\"" }))).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
    expect((await handler(new Request("https://local.test", { method: "POST", headers: { Authorization: "Bearer private-token-long-1" } }))).status).toBe(400);
  });
  test("supervised mode requires one authorized target in a header, never URL or body", async () => {
    const target = "11111111-1111-1111-1111-111111111111";
    const run = vi.fn(async (_paymentId: string) => ({ processed: 0, succeeded: 0, held: 0 }));
    const handler = createPayperWorkerHandler("private-token-long-1", run);
    const headers = { Authorization: "Bearer private-token-long-1" };
    expect((await handler(new Request("https://local.test", { method: "POST", headers }))).status).toBe(400);
    expect((await handler(new Request("https://local.test", { method: "POST", headers: { ...headers, "x-payper-target-payment-id": "wrong" } }))).status).toBe(400);
    expect((await handler(new Request("https://local.test?paymentId=" + target, { method: "POST", headers: { ...headers, "x-payper-target-payment-id": target } }))).status).toBe(400);
    expect((await handler(new Request("https://local.test", { method: "POST", headers: { ...headers, "x-payper-target-payment-id": target }, body: "{}" }))).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
    expect((await handler(new Request("https://local.test", { method: "POST", headers: { ...headers, "x-payper-target-payment-id": target } }))).status).toBe(200);
    expect(run).toHaveBeenCalledExactlyOnceWith(target);
  });
  test("supervised batch cannot issue another concurrent eligible payment", async () => {
    const target = "11111111-1111-1111-1111-111111111111";
    const other = "22222222-2222-2222-2222-222222222222";
    const issue = vi.fn(async () => ({ state: "succeeded" as const }));
    const deps = { targetPaymentId: target, listCandidates: async () => [other, target], issue };
    expect(await runPayperIssuanceBatch(deps)).toEqual({ processed: 1, succeeded: 1, held: 0 });
    expect(issue).toHaveBeenCalledExactlyOnceWith(target);
    issue.mockClear();
    expect(await runPayperIssuanceBatch({ ...deps, listCandidates: async () => [other] }))
      .toEqual({ processed: 0, succeeded: 0, held: 0 });
    expect(issue).not.toHaveBeenCalled();
  });
  test("automatic scan is separately gated, token protected and has no caller target", async () => {
    const target = "11111111-1111-1111-1111-111111111111";
    const runTarget = vi.fn(async () => ({ processed: 0, succeeded: 0, held: 0 }));
    const runAuto = vi.fn(async () => ({ processed: 1, succeeded: 1, held: 0 }));
    const secret = "private-token-long-1";
    const headers = { Authorization: `Bearer ${secret}`, "x-payper-mode": "automatic" };
    const disabled = createPayperWorkerHandler(secret, runTarget, { runAuto, automaticEnabled: false });
    expect((await disabled(new Request("https://local.test", { method: "POST", headers }))).status).toBe(403);
    expect(runAuto).not.toHaveBeenCalled();
    const enabled = createPayperWorkerHandler(secret, runTarget, { runAuto, automaticEnabled: true });
    expect((await enabled(new Request("https://local.test", { method: "POST", headers: { ...headers,
      Authorization: "Bearer wrong" } }))).status).toBe(401);
    expect((await enabled(new Request("https://local.test", { method: "POST", headers: { ...headers,
      "x-payper-target-payment-id": target } }))).status).toBe(400);
    expect((await enabled(new Request("https://local.test?paymentId=" + target, { method: "POST", headers }))).status).toBe(400);
    expect((await enabled(new Request("https://local.test", { method: "POST", headers, body: "{\"paymentId\":\"old\"}" }))).status).toBe(400);
    expect(runAuto).not.toHaveBeenCalled();
    expect((await enabled(new Request("https://local.test", { method: "POST", headers }))).status).toBe(200);
    expect((await enabled(new Request("https://local.test", { method: "POST", headers, body: "{}" }))).status).toBe(200);
    expect(runAuto).toHaveBeenCalledTimes(2);
    expect(runTarget).not.toHaveBeenCalled();
  });
  test("read-only lookup is token protected, requires a verified target, and cannot dispatch", async () => {
    const target = "28b4786f-e722-40ae-9661-f3e805fc71bf";
    const secret = "private-token-long-1";
    const runTarget = vi.fn();
    const runAuto = vi.fn();
    const runLookup = vi.fn(async () => ({ verified: true, transactionRecordId: "3175016155" }));
    const handler = createPayperWorkerHandler(secret, runTarget, { runAuto, automaticEnabled: false },
      { runLookup, enabled: true });
    const headers = { Authorization: `Bearer ${secret}`, "x-payper-mode": "lookup-diagnostic",
      "x-payper-target-payment-id": target };
    expect((await handler(new Request("https://local.test", { method: "POST", headers: {
      ...headers, Authorization: "Bearer wrong" } }))).status).toBe(401);
    expect((await handler(new Request("https://local.test", { method: "POST", headers: {
      ...headers, "x-payper-target-payment-id": "invalid" } }))).status).toBe(400);
    expect((await handler(new Request("https://local.test", { method: "POST", headers,
      body: "{}" }))).status).toBe(400);
    expect((await handler(new Request("https://local.test", { method: "POST", headers,
      body: "{" }))).status).toBe(400);
    expect(await (await handler(new Request("https://local.test", { method: "POST", headers }))).json())
      .toEqual({ verified: true, transactionRecordId: "3175016155" });
    expect(await (await handler(new Request("https://local.test", { method: "POST", headers,
      body: new Uint8Array() }))).json())
      .toEqual({ verified: true, transactionRecordId: "3175016155" });
    expect(runLookup).toHaveBeenCalledTimes(2);
    expect(runLookup).toHaveBeenLastCalledWith(target);
    expect(runTarget).not.toHaveBeenCalled();
    expect(runAuto).not.toHaveBeenCalled();
    const disabled = createPayperWorkerHandler(secret, runTarget, null, { runLookup, enabled: false });
    expect((await disabled(new Request("https://local.test", { method: "POST", headers }))).status).toBe(403);
    runLookup.mockRejectedValueOnce(new Error("private provider detail"));
    expect(await (await handler(new Request("https://local.test", { method: "POST", headers }))).json())
      .toEqual({ error: "lookup_unavailable" });
    runLookup.mockRejectedValueOnce(new Error("provider_credentials_rejected"));
    expect(await (await handler(new Request("https://local.test", { method: "POST", headers }))).json())
      .toEqual({ error: "provider_credentials_rejected" });
  });
  test("scheduled recovery issues a missed-wake candidate once and leaves an uncertain result held", async () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    const eligible = new Set([first, second]);
    const issue = vi.fn(async (id: string) => {
      eligible.delete(id);
      return { state: id === first ? "succeeded" as const : "reconciliation_required" as const };
    });
    const runAuto = async () => {
      const oldest = [...eligible][0];
      return runPayperIssuanceBatch({ targetPaymentId: oldest ?? "", listCandidates: async () => [...eligible], issue });
    };
    const handler = createPayperWorkerHandler("private-token-long-1", vi.fn(),
      { automaticEnabled: true, runAuto });
    const request = () => new Request("https://local.test", { method: "POST",
      headers: { Authorization: "Bearer private-token-long-1", "x-payper-mode": "automatic" }, body: "{}" });
    expect(await (await handler(request())).json()).toEqual({ processed: 1, succeeded: 1, held: 0 });
    expect(await (await handler(request())).json()).toEqual({ processed: 1, succeeded: 0, held: 1 });
    expect(await (await handler(request())).json()).toEqual({ processed: 0, succeeded: 0, held: 0 });
    expect(issue).toHaveBeenCalledTimes(2);
  });
});
