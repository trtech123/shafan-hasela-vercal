import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { cancelRecurringSale, normalizeIpn, prepareVerifiedIpn } from "../_shared/icredit.ts";

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

    const rawEvent = await readIpn(req);
    const event = normalizeIpn(rawEvent);
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
    if (agreement.provider_recurring_id && agreement.provider_recurring_id !== event.recurringId) {
      return json({ ok: false, error: "recurring agreement mismatch" }, 409);
    }

    const membership = Array.isArray(agreement.membership)
      ? agreement.membership[0]
      : agreement.membership;
    if (!membership) return json({ ok: false, error: "membership not found" }, 404);
    const expectedAmount = Number(membership.monthly_price);

    const prepared = await prepareVerifiedIpn(fetch, {
      raw: rawEvent,
      groupPrivateToken,
      agreementId: agreement.id,
      providerRecurringId: agreement.provider_recurring_id,
      expectedAmount,
    });

    const { data: result, error: processError } = await adminClient.rpc(
      "process_icredit_recurring_event",
      {
        p_agreement_id: agreement.id,
        p_event_digest: prepared.digest,
        p_event_kind: prepared.kind,
        p_provider_sale_id: prepared.event.saleId,
        p_provider_recurring_id: prepared.event.recurringId,
        p_provider_charge_number: prepared.event.chargeNumber,
        p_amount: expectedAmount,
        p_failure_code: prepared.event.failureCode,
        p_failure_message: prepared.event.failureMessage,
      },
    );
    if (processError) return json({ ok: false, error: "could not reconcile verified IPN" }, 500);

    if (result?.compensation_required) {
      await cancelRecurringSale(fetch, prepared.event.recurringId);
      const { data: compensation, error: compensationError } = await adminClient.rpc(
        "complete_icredit_enrollment_compensation",
        {
          p_agreement_id: agreement.id,
          p_provider_recurring_id: prepared.event.recurringId,
        },
      );
      if (compensationError || !compensation?.compensated) {
        return json({ ok: false, error: "provider cancellation compensation could not be recorded" }, 500);
      }
    }

    return json({ ok: true, duplicate: Boolean(result?.duplicate) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid IPN";
    const status = /not verified|payment page identifier|amount does not match/i.test(message) ? 401 : 400;
    return json({ ok: false, error: message }, status);
  }
});
