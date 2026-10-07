// Standalone Rivhit accounting endpoint.
// No payment provider invokes this function in this phase.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { RivhitClient, RivhitError } from "../_shared/rivhit/client.ts";
import { getDocumentMapping, parseDocumentTypeMap } from "../_shared/rivhit/config.ts";
import { mapOrderToAccountingSource } from "../_shared/rivhit/order-mapper.ts";
import { SupabaseAccountingRepository } from "../_shared/rivhit/supabase-repository.ts";
import { runRivhitAccounting } from "../_shared/rivhit/workflow.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rivhitApiToken = Deno.env.get("RIVHIT_API_TOKEN");
  const documentMapRaw = Deno.env.get("RIVHIT_DOCUMENT_TYPE_MAP");
  const accountingMode = Deno.env.get("RIVHIT_ACCOUNTING_MODE");
  const accountNamespace = Deno.env.get("RIVHIT_ACCOUNT_NAMESPACE")?.trim();

  if (!supabaseUrl || !anonKey || !serviceKey || !rivhitApiToken || !accountNamespace) {
    return json({ ok: false, error: "server accounting configuration is incomplete" }, 500);
  }
  if (accountingMode !== "sandbox" && accountingMode !== "production") {
    return json({ ok: false, error: "RIVHIT_ACCOUNTING_MODE must be sandbox or production" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ ok: false, error: "missing authorization" }, 401);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !caller) {
    return json({ ok: false, error: "invalid session" }, 401);
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .single();
  if (
    profileError
    || !callerProfile
    || !["admin", "operations"].includes(callerProfile.role)
  ) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }

  const sourceType = body.sourceType;
  const sourceId = body.sourceId;
  const documentTypeKey = typeof body.documentTypeKey === "string"
    ? body.documentTypeKey.trim()
    : "";
  if (sourceType !== "order" || !isUuid(sourceId) || !documentTypeKey) {
    return json({
      ok: false,
      error: "sourceType=order, UUID sourceId and documentTypeKey are required",
    }, 400);
  }

  try {
    const mappings = parseDocumentTypeMap(documentMapRaw);
    const mapping = getDocumentMapping(mappings, documentTypeKey);
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("*")
      .eq("id", sourceId)
      .single();
    if (orderError || !order) {
      return json({ ok: false, error: "source order not found" }, 404);
    }

    let activityName: string | null = null;
    if (order.activity_id) {
      const { data: activity } = await adminClient
        .from("activities")
        .select("name")
        .eq("id", order.activity_id)
        .maybeSingle();
      activityName = activity?.name ?? null;
    }

    const source = await mapOrderToAccountingSource(
      order,
      activityName,
      documentTypeKey,
      mapping,
      accountNamespace,
    );
    const rivhitClient = new RivhitClient({ apiToken: rivhitApiToken });
    const repository = new SupabaseAccountingRepository(adminClient);
    const result = await runRivhitAccounting({
      source,
      repository,
      client: rivhitClient,
    });

    if (result.status !== "succeeded") {
      if (
        result.status === "permanent_error"
        || result.status === "reconciliation_required"
      ) {
        return json({ ok: false, mode: accountingMode, ...result }, 409);
      }
      return json({ ok: true, mode: accountingMode, ...result }, 202);
    }
    return json({ ok: true, mode: accountingMode, ...result });
  } catch (error) {
    if (error instanceof RivhitError) {
      const status = error.reconciliationRequired || !error.retryable ? 409 : 503;
      return json({
        ok: false,
        error: error.message,
        errorCode: error.errorCode,
        retryable: error.retryable,
        reconciliationRequired: error.reconciliationRequired,
      }, status);
    }
    const message = error instanceof Error ? error.message : "accounting request failed";
    const status = message.includes("mapping") || message.includes("amount") ? 400 : 500;
    return json({ ok: false, error: message }, status);
  }
});
