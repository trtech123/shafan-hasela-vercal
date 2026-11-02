import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { createPayperIssuanceRuntime } from "../_shared/payper/runtime.ts";
import { createPayperWorkerHandler, runPayperIssuanceBatch } from "../_shared/payper/worker.ts";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("payper_worker_configuration_required");
  return value;
}

// Supervised invocations require a target. Automatic scanning has a separate
// explicit switch and may only read the durable post-verification ledger.
Deno.serve(async (request) => {
  try {
    const secret = required("PAYPER_WORKER_TOKEN");
    const dispatch = async (targetPaymentId: string | null) => {
      if (Deno.env.get("PAYPER_DISPATCH_ENABLED") !== "true")
        return { processed: 0, succeeded: 0, held: 0 };
      const client = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"),
        { auth: { autoRefreshToken: false, persistSession: false } });
      const control = await client.from("payper_dispatch_control")
        .select("enabled,activation_cutoff_utc,future_cutoff_utc,dispatch_remaining,dispatch_mode,canary_payment_id")
        .eq("singleton", true).single();
      if (control.error || !control.data) throw new Error("payper_control_unavailable");
      if (control.data.enabled !== true || !control.data.activation_cutoff_utc
        || !["canary", "continuous"].includes(control.data.dispatch_mode)
        || (control.data.dispatch_mode === "canary" &&
          (!control.data.canary_payment_id || control.data.dispatch_remaining !== 1)))
        return { processed: 0, succeeded: 0, held: 0 };
      if (control.data.dispatch_mode === "canary" && targetPaymentId &&
        targetPaymentId !== control.data.canary_payment_id)
        return { processed: 0, succeeded: 0, held: 0 };
      const constrainedTarget = control.data.dispatch_mode === "canary"
        ? control.data.canary_payment_id : targetPaymentId;
      const { data, error } = await client.rpc("list_payper_dispatch_candidates",
        { p_target_payment_id: constrainedTarget });
      if (error || !Array.isArray(data)) throw new Error("payper_candidates_unavailable");
      const selectedPaymentId = targetPaymentId ?? data[0]?.payment_id;
      if (!selectedPaymentId) return { processed: 0, succeeded: 0, held: 0 };
      const runtime = createPayperIssuanceRuntime({ serviceClient: client, env: {
        PELECARD_TERMINAL: Deno.env.get("PELECARD_TERMINAL"),
        PELECARD_USER: Deno.env.get("PELECARD_USER"),
        PELECARD_PASSWORD: Deno.env.get("PELECARD_PASSWORD"),
        PAYPER_DISPATCH_ENABLED: Deno.env.get("PAYPER_DISPATCH_ENABLED"),
        PAYPER_SEND_BY_MAIL: Deno.env.get("PAYPER_SEND_BY_MAIL"),
      } });
      return runPayperIssuanceBatch({
        listCandidates: async () => data.map(row => row.payment_id),
        targetPaymentId: selectedPaymentId,
        issue: runtime.issue,
        holdFailure: runtime.holdFailure,
      });
    };
    const handler = createPayperWorkerHandler(secret, (targetPaymentId) => dispatch(targetPaymentId), {
      automaticEnabled: Deno.env.get("PAYPER_AUTO_SCAN_ENABLED") === "true",
      runAuto: () => dispatch(null),
    });
    return handler(request);
  } catch {
    return new Response(JSON.stringify({ error: "worker_unavailable" }),
      { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
});
