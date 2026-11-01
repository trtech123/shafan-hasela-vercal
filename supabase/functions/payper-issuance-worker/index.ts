import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { createPayperIssuanceRuntime } from "../_shared/payper/runtime.ts";
import { createPayperWorkerHandler, runPayperIssuanceBatch } from "../_shared/payper/worker.ts";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("payper_worker_configuration_required");
  return value;
}

// Every invocation requires a server-authorized target header. This release
// has no automatic oldest-payment mode.
Deno.serve(async (request) => {
  try {
    const secret = required("PAYPER_WORKER_TOKEN");
    const handler = createPayperWorkerHandler(secret, async (targetPaymentId) => {
      if (Deno.env.get("PAYPER_DISPATCH_ENABLED") !== "true")
        return { processed: 0, succeeded: 0, held: 0 };
      const client = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"),
        { auth: { autoRefreshToken: false, persistSession: false } });
      const control = await client.from("payper_dispatch_control")
        .select("enabled,activation_cutoff_utc,dispatch_remaining").eq("singleton", true).single();
      if (control.error || !control.data) throw new Error("payper_control_unavailable");
      if (control.data.enabled !== true || !control.data.activation_cutoff_utc
        || control.data.dispatch_remaining < 1)
        return { processed: 0, succeeded: 0, held: 0 };
      let candidates = client.from("payper_document_ledger")
        .select("payment_id").in("state", ["eligible", "source_frozen"])
        .order("created_at", { ascending: true }).limit(1);
      candidates = candidates.eq("payment_id", targetPaymentId);
      const { data, error } = await candidates;
      if (error || !Array.isArray(data)) throw new Error("payper_candidates_unavailable");
      const runtime = createPayperIssuanceRuntime({ serviceClient: client, env: {
        PELECARD_TERMINAL: Deno.env.get("PELECARD_TERMINAL"),
        PELECARD_USER: Deno.env.get("PELECARD_USER"),
        PELECARD_PASSWORD: Deno.env.get("PELECARD_PASSWORD"),
        PAYPER_DISPATCH_ENABLED: Deno.env.get("PAYPER_DISPATCH_ENABLED"),
        PAYPER_SEND_BY_MAIL: Deno.env.get("PAYPER_SEND_BY_MAIL"),
      } });
      return runPayperIssuanceBatch({
        listCandidates: async () => data.map(row => row.payment_id),
        targetPaymentId,
        issue: runtime.issue,
        holdFailure: runtime.holdFailure,
      });
    });
    return handler(request);
  } catch {
    return new Response(JSON.stringify({ error: "worker_unavailable" }),
      { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
});
