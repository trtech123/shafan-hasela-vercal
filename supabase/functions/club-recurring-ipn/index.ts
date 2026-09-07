import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { classifyIpn, createEventDigest, normalizeIpn, verifyIpn } from "../_shared/icredit.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readIpn(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await req.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid IPN body");
    return data as Record<string, unknown>;
  }
  const form = await req.formData();
  const values: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const groupPrivateToken = Deno.env.get("ICREDIT_GROUP_PRIVATE_TOKEN");
    if (!supabaseUrl || !serviceKey || !groupPrivateToken) {
      return json({ ok: false, error: "server not configured" }, 500);
    }

    const event = normalizeIpn(await readIpn(req));
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: agreement, error: agreementError } = await adminClient
      .from("recurring_agreements")
      .select(`
        id, provider_environment, status, provider_recurring_id,
        membership:club_memberships!inner(id, monthly_price, status)
      `)
      .eq("id", event.agreementId)
      .single();
    if (agreementError || !agreement) return json({ ok: false, error: "agreement not found" }, 404);
    if (agreement.provider_environment !== "test") return json({ ok: false, error: "TEST agreement required" }, 409);
    if (agreement.status === "cancelled") return json({ ok: false, error: "agreement is cancelled" }, 409);
    if (agreement.provider_recurring_id && agreement.provider_recurring_id !== event.recurringId) {
      return json({ ok: false, error: "recurring agreement mismatch" }, 409);
    }

    const membership = Array.isArray(agreement.membership)
      ? agreement.membership[0]
      : agreement.membership;
    if (!membership) return json({ ok: false, error: "membership not found" }, 404);
    const expectedAmount = Number(membership.monthly_price);

    await verifyIpn(fetch, { groupPrivateToken, event, expectedAmount });
    const kind = classifyIpn(event);
    const digest = await createEventDigest(event, kind);

    const { data: result, error: processError } = await adminClient.rpc(
      "process_icredit_recurring_event",
      {
        p_agreement_id: agreement.id,
        p_event_digest: digest,
        p_event_kind: kind,
        p_provider_sale_id: event.saleId,
        p_provider_recurring_id: event.recurringId,
        p_provider_charge_number: event.chargeNumber,
        p_amount: expectedAmount,
        p_failure_code: event.failureCode,
        p_failure_message: event.failureMessage,
      },
    );
    if (processError) return json({ ok: false, error: "could not reconcile verified IPN" }, 500);

    return json({ ok: true, duplicate: Boolean(result?.duplicate) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid IPN";
    const status = /not verified|payment page identifier|amount does not match/i.test(message) ? 401 : 400;
    return json({ ok: false, error: message }, status);
  }
});
