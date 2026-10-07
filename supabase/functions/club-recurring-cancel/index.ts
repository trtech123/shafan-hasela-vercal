import { cancelRecurringSale, IcreditCancellationRejectedError } from "./_deployed_shared/icredit.ts";
import { corsHeaders, HttpError, json, requireAdmin } from "./_deployed_shared/admin.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  try {
    const { adminClient } = await requireAdmin(req);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "invalid JSON body");
    }
    const membershipId = String(body.membershipId ?? "").trim();
    if (!membershipId) throw new HttpError(400, "missing membershipId");

    const { data: membership, error: membershipError } = await adminClient
      .from("club_memberships")
      .select("id, status, cancellation_effective_on")
      .eq("id", membershipId)
      .single();
    if (membershipError || !membership) throw new HttpError(404, "membership not found");
    if (membership.status !== "cancellation_scheduled" || !membership.cancellation_effective_on) {
      throw new HttpError(409, "cancellation must be scheduled first");
    }
    const israelDateParts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const israelDateValues = Object.fromEntries(israelDateParts.map((part) => [part.type, part.value]));
    const todayInIsrael = `${israelDateValues.year}-${israelDateValues.month}-${israelDateValues.day}`;
    if (todayInIsrael < membership.cancellation_effective_on) {
      throw new HttpError(409, `cancellation becomes effective on ${membership.cancellation_effective_on}`);
    }

    const { data: agreement, error: agreementError } = await adminClient
      .from("recurring_agreements")
      .select("id, membership_id, provider_environment, provider_recurring_id, status")
      .eq("membership_id", membershipId)
      .single();
    if (agreementError || !agreement) throw new HttpError(404, "recurring agreement not found");
    if (agreement.provider_environment !== "test") throw new HttpError(409, "TEST agreement required");
    if (agreement.status === "cancelled") {
      return json({ ok: true, membershipId, agreementId: agreement.id, reused: true });
    }

    const finalizeLocalCancellation = async () => {
      const { data: cancelled, error: cancelError } = await adminClient.rpc(
        "cancel_icredit_recurring_membership",
        { p_membership_id: membershipId, p_agreement_id: agreement.id },
      );
      if (cancelError || !cancelled?.cancelled) {
        throw new HttpError(500, "provider cancelled but local finalization failed");
      }
      return cancelled;
    };

    if (agreement.status === "provider_cancelled") {
      await finalizeLocalCancellation();
      return json({ ok: true, membershipId, agreementId: agreement.id, recovered: true });
    }

    if (agreement.status === "pending_enrollment" && !agreement.provider_recurring_id) {
      await finalizeLocalCancellation();
      return json({ ok: true, membershipId, agreementId: agreement.id, pendingEnrollment: true });
    }

    if (!agreement.provider_recurring_id || !["active", "cancellation_pending"].includes(agreement.status)) {
      throw new HttpError(409, "recurring agreement cannot be cancelled");
    }

    if (agreement.status === "active") {
      const { error: pendingError } = await adminClient
        .from("recurring_agreements")
        .update({ status: "cancellation_pending", cancellation_requested_at: new Date().toISOString() })
        .eq("id", agreement.id)
        .eq("status", "active");
      if (pendingError) throw new HttpError(500, "could not prepare recurring cancellation");
    }

    try {
      await cancelRecurringSale(fetch, agreement.provider_recurring_id);
    } catch (providerError) {
      if (providerError instanceof IcreditCancellationRejectedError && agreement.status === "active") {
        const { error: restoreError } = await adminClient
          .from("recurring_agreements")
          .update({ status: "active", cancellation_requested_at: null })
          .eq("id", agreement.id)
          .eq("status", "cancellation_pending");
        if (restoreError) {
          throw new HttpError(500, "provider cancellation failed and local pending state could not be restored");
        }
      }
      const message = providerError instanceof Error
        ? providerError.message
        : "iCredit recurring cancellation failed";
      throw new HttpError(502, message);
    }

    const { data: providerConfirmed, error: providerConfirmedError } = await adminClient
      .from("recurring_agreements")
      .update({ status: "provider_cancelled" })
      .eq("id", agreement.id)
      .in("status", ["active", "cancellation_pending"])
      .select("id")
      .maybeSingle();
    if (providerConfirmedError) {
      throw new HttpError(500, "provider cancelled but confirmation could not be recorded");
    }
    if (!providerConfirmed) {
      const { data: current, error: currentError } = await adminClient
        .from("recurring_agreements")
        .select("status")
        .eq("id", agreement.id)
        .single();
      if (currentError || !["provider_cancelled", "cancelled"].includes(current?.status)) {
        throw new HttpError(409, "provider confirmation state changed concurrently");
      }
      if (current.status === "cancelled") {
        return json({ ok: true, membershipId, agreementId: agreement.id, reused: true });
      }
    }
    await finalizeLocalCancellation();

    return json({ ok: true, membershipId, agreementId: agreement.id, reused: false });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502;
    const message = error instanceof Error ? error.message : "unexpected cancellation error";
    return json({ ok: false, error: message }, status);
  }
});
