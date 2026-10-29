import type { PayperDispatchOutcome } from "./outcome.ts";

export interface PayperWorkerDependencies {
  listCandidates(): Promise<string[]>;
  targetPaymentId: string;
  issue(paymentId: string): Promise<PayperDispatchOutcome>;
  holdFailure?(paymentId: string): Promise<void>;
}

/** Polls only database-created ledger candidates. A failed dispatch reservation is one-shot. */
export async function runPayperIssuanceBatch(deps: PayperWorkerDependencies): Promise<{
  processed: number; succeeded: number; held: number;
}> {
  const ids = await deps.listCandidates();
  // The supervised invocation may see concurrent eligible rows. It must
  // never fall through to the oldest other payment if its target is absent.
  const selected = ids.filter(id => id === deps.targetPaymentId);
  let processed = 0, succeeded = 0, held = 0;
  // One candidate per invocation keeps the supervised first-document quota
  // from turning later valid candidates into pre-dispatch failures.
  for (const id of new Set(selected.slice(0, 1))) {
    if (!id) continue;
    processed++;
    try {
      const result = await deps.issue(id);
      if (result.state === "succeeded") succeeded++;
      else held++;
    } catch (error) {
      // Before reservation, the source stays unissued. After reservation, its
      // durable state cannot be selected again and requires manual review.
      if (error instanceof Error && error.message === "payper_dispatch_limit_reached") break;
      held++;
      try { await deps.holdFailure?.(id); } catch { /* reservation may already be durable */ }
    }
  }
  return { processed, succeeded, held };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createPayperWorkerHandler(secret: string, run: (targetPaymentId: string) => Promise<unknown>) {
  if (!secret || secret.length < 16) throw new Error("payper_worker_token_required");
  return async (request: Request): Promise<Response> => {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (request.method !== "POST") return new Response(null, { status: 405, headers });
    if (request.headers.get("authorization") !== `Bearer ${secret}`)
      return new Response(null, { status: 401, headers });
    if (request.url.includes("?") || request.body !== null)
      return new Response(null, { status: 400, headers });
    const suppliedTarget = request.headers.get("x-payper-target-payment-id");
    if (!suppliedTarget || !uuid.test(suppliedTarget))
      return new Response(null, { status: 400, headers });
    try {
      return new Response(JSON.stringify(await run(suppliedTarget)), { status: 200, headers });
    } catch {
      return new Response(JSON.stringify({ error: "worker_unavailable" }), { status: 503, headers });
    }
  };
}
