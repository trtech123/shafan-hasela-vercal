import { describe, expect, test, vi } from "vitest";
import { createCommercialFeedback, recoverCommercial } from "./pelecard-commercial.ts";
import { createPayperAutoWake } from "./payper-auto-wake.ts";
import { createPayperWorkerHandler, runPayperIssuanceBatch } from "../../_shared/payper/worker.ts";

const paymentId = "c0000000-0000-4000-8000-000000000001";
const attempt = {
  payment_id: paymentId, order_id: "a0000000-0000-4000-8000-000000000001",
  amount_minor: 10000, currency: "ILS", transaction_id: "hosted-1",
  confirmation_key: "confirmation-1", hosted_state: "usable",
};
const approved = { StatusCode: "000", ResultData: {
  ShvaResult: "000", TransactionId: "hosted-1", ConfirmationKey: "confirmation-1",
  JParam: "4", DebitTotal: "10000", DebitCurrency: "1", DebitType: "01",
  ApprovedBy: "1", DebitApproveNumber: "123456",
} };

function recovery(response: unknown, onPaymentFinalized = vi.fn()) {
  const finalize = vi.fn(async () => ({ status: "succeeded" }));
  const deps = {
    read: () => undefined, auth: { authenticate: async () => null }, allowedOrigins: [], log: () => {},
    view: vi.fn(), reserve: vi.fn(), get: vi.fn(), observe: vi.fn(async () => {}), finalize,
    call: vi.fn(async (action: string) => action === "lookup" ? response
      : action === "hosted" ? { reachable: true, state: "usable" } : 1),
    onPaymentFinalized,
  };
  return { deps, finalize, onPaymentFinalized };
}

describe("verified payment to Payper wake", () => {
  test("Orders raw JSON callback records only sanitized nonapproval evidence", async () => {
    const hostedId = "e0000000-0000-4000-8000-000000000001";
    const stored = { ...attempt, transaction_id: hostedId };
    const log = vi.fn(), finalize = vi.fn(), onPaymentFinalized = vi.fn();
    const deps = {
      read: () => undefined, auth: { authenticate: async () => null }, allowedOrigins: [], log,
      view: vi.fn(), reserve: vi.fn(), get: vi.fn(async () => stored), observe: vi.fn(async () => {}),
      finalize, onPaymentFinalized,
      call: vi.fn(async (action: string) => action === "lookup"
        ? { StatusCode: "425", ResultData: { ShvaResult: "173" } }
        : action === "hosted" ? { reachable: true, state: "usable" } : 1),
    };
    const request = new Request(`https://edge.test/feedback?paymentId=${paymentId}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: JSON.stringify({ ResultData: { ConfirmationKey: stored.confirmation_key, TransactionId: hostedId } }),
    });
    expect((await createCommercialFeedback(deps)(request)).status).toBe(200);
    expect(finalize).not.toHaveBeenCalled();
    expect(onPaymentFinalized).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({ event: "pelecard_order_callback_checked", paymentId,
      approved: false, apiStatus: "425", transactionStatus: "173" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(stored.confirmation_key);
  });
  test("wakes only after durable approved finalization with the stored payment ID", async () => {
    const { deps, finalize, onPaymentFinalized } = recovery(approved);
    expect((await recoverCommercial(deps, attempt)).approved).toBe(true);
    expect(finalize).toHaveBeenCalledOnce();
    expect(onPaymentFinalized).toHaveBeenCalledExactlyOnceWith(paymentId);
    expect(finalize.mock.invocationCallOrder[0]).toBeLessThan(onPaymentFinalized.mock.invocationCallOrder[0]);
  });

  test("does not wake on an unapproved transaction or failed finalization", async () => {
    const declined = recovery({ StatusCode: "000", ResultData: { ShvaResult: "005" } });
    expect((await recoverCommercial(declined.deps, attempt)).approved).toBe(false);
    expect(declined.onPaymentFinalized).not.toHaveBeenCalled();
    const failed = recovery(approved);
    failed.finalize.mockRejectedValueOnce(new Error("database_unavailable"));
    await expect(recoverCommercial(failed.deps, attempt)).rejects.toThrow("database_unavailable");
    expect(failed.onPaymentFinalized).not.toHaveBeenCalled();
  });

  test("a failed wake never reverses a finalized card payment", async () => {
    const { deps, finalize } = recovery(approved, vi.fn(() => { throw new Error("wake_unavailable"); }));
    expect((await recoverCommercial(deps, attempt)).approved).toBe(true);
    expect(finalize).toHaveBeenCalledOnce();
  });

  test("the server wake is disabled by default and sends only a verified target when enabled", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ processed: 1 }), { status: 200 }));
    const log = vi.fn();
    await createPayperAutoWake({ read: () => undefined, fetcher, log })(paymentId);
    expect(fetcher).not.toHaveBeenCalled();
    const read = (name: string) => ({ PAYPER_AUTO_WAKE_ENABLED: "true", PAYPER_DISPATCH_ENABLED: "true",
      PAYPER_WORKER_TOKEN: "test-secret-at-least-sixteen", SUPABASE_URL: "https://project.supabase.co" } as Record<string, string>)[name];
    await createPayperAutoWake({ read, fetcher, log })(paymentId);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://project.supabase.co/functions/v1/payper-issuance-worker");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>)["x-payper-target-payment-id"]).toBe(paymentId);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-secret-at-least-sixteen");
  });

  test("rejects credentials in the endpoint URL and never leaks the worker token to another host", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    const log = vi.fn();
    const values = { PAYPER_AUTO_WAKE_ENABLED: "true", PAYPER_DISPATCH_ENABLED: "true",
      PAYPER_WORKER_TOKEN: "test-secret-at-least-sixteen",
      SUPABASE_URL: "https://userinfo:password@project.supabase.co/" } as Record<string, string>;
    await createPayperAutoWake({ read: name => values[name], fetcher, log })(paymentId);
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(values.PAYPER_WORKER_TOKEN);
    values.SUPABASE_URL = "https://attacker.example/";
    await createPayperAutoWake({ read: name => values[name], fetcher, log })(paymentId);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("a rejected wake is logged once without retrying or exposing provider response", async () => {
    const fetcher = vi.fn(async () => new Response("private detail", { status: 503 }));
    const log = vi.fn();
    const values = { PAYPER_AUTO_WAKE_ENABLED: "true", PAYPER_DISPATCH_ENABLED: "true",
      PAYPER_WORKER_TOKEN: "test-secret-at-least-sixteen",
      SUPABASE_URL: "https://project.supabase.co/" } as Record<string, string>;
    await createPayperAutoWake({ read: name => values[name], fetcher, log })(paymentId);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith({ event: "payper_auto_wake_failed", status: 503 });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private detail");
  });

  test("duplicate verified callbacks wake the worker but an uncertain invoice dispatch happens once", async () => {
    let state = "eligible";
    const provider = vi.fn(async () => ({ state: "reconciliation_required" as const }));
    const runTarget = (targetPaymentId: string) => runPayperIssuanceBatch({
      targetPaymentId,
      listCandidates: async () => state === "eligible" ? [paymentId] : [],
      issue: async id => { if (state !== "eligible") return { state: "reconciliation_required" as const };
        state = "dispatch_reserved"; const result = await provider(id);
        state = "reconciliation_required"; return result; },
    });
    const handler = createPayperWorkerHandler("test-secret-at-least-sixteen", runTarget);
    const values = { PAYPER_AUTO_WAKE_ENABLED: "true", PAYPER_DISPATCH_ENABLED: "true",
      PAYPER_WORKER_TOKEN: "test-secret-at-least-sixteen",
      SUPABASE_URL: "https://project.supabase.co/" } as Record<string, string>;
    const wake = createPayperAutoWake({ read: name => values[name], log: vi.fn(),
      fetcher: (url, init) => handler(new Request(url, init)) });
    const pending: Promise<void>[] = [];
    const first = recovery(approved, vi.fn(id => { pending.push(wake(id)); }));
    const second = recovery(approved, vi.fn(id => { pending.push(wake(id)); }));
    await Promise.all([recoverCommercial(first.deps, attempt), recoverCommercial(second.deps, attempt)]);
    await Promise.all(pending);
    expect(provider).toHaveBeenCalledExactlyOnceWith(paymentId);
    expect(state).toBe("reconciliation_required");
    await wake(paymentId);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
