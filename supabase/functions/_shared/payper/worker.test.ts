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
    expect(await runPayperIssuanceBatch({ targetPaymentId: "new-1", listCandidates: async () => ["new-1"],
      issue: async () => { throw new Error("private database detail"); }, holdFailure })).toEqual({ processed: 1, succeeded: 0, held: 1 });
    expect(holdFailure).toHaveBeenCalledWith("new-1");
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
});
