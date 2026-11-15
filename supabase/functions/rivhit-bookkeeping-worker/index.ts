// Standalone bookkeeping dispatch. No import from legacy Rivhit or payment code.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { readJournalConfiguration } from "../_shared/rivhit-bookkeeping/config.ts";
import { createJournalClient } from "../_shared/rivhit-bookkeeping/client.ts";
import { createJournalRepository } from "../_shared/rivhit-bookkeeping/repository.ts";
import { processJournalLeg } from "../_shared/rivhit-bookkeeping/worker.ts";

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status,
    headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey || request.headers.get("Authorization") !== `Bearer ${serviceKey}`)
    return response(401, { error: "unauthorized" });

  const config = readJournalConfiguration({
    RIVHIT_JOURNAL_ENABLED: Deno.env.get("RIVHIT_JOURNAL_ENABLED"),
    RIVHIT_JOURNAL_MAPPING_JSON: Deno.env.get("RIVHIT_JOURNAL_MAPPING_JSON"),
  });
  if (!config.enabled) return response(503, { status: "configuration_required" });
  const apiToken = Deno.env.get("RIVHIT_API_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!apiToken || !supabaseUrl) return response(503, { status: "configuration_required" });

  let body: unknown;
  try { body = await request.json(); } catch { return response(400, { error: "invalid_request" }); }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return response(400, { error: "invalid_request" });
  const legId = (body as Record<string, unknown>).leg_id;
  if (typeof legId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(legId))
    return response(400, { error: "invalid_leg_id" });

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  try {
    const result = await processJournalLeg({ enabled: config.enabled, legId,
      repository: createJournalRepository(db, config.mapping),
      client: createJournalClient({ apiToken, enabled: config.enabled }),
    });
    return response(200, result);
  } catch {
    return response(500, { status: "reconciliation_required" });
  }
});
