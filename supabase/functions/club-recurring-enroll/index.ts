import { buildEnrollmentRequest, ICREDIT_TEST_BASE_URL, readEnrollmentResponse } from "../_shared/icredit.ts";
import { corsHeaders, HttpError, json, requireAdmin } from "../_shared/admin.ts";

type MembershipRow = {
  id: string;
  monthly_price: number;
  billing_day: number;
  starts_on: string;
  status: string;
  club: { id: string; name: string };
  participant: {
    first_name: string;
    last_name: string;
    phone: string | null;
    email: string | null;
    primary_contact_phone: string | null;
    primary_contact_email: string | null;
  };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  try {
    const { adminClient } = await requireAdmin(req);
    const groupPrivateToken = Deno.env.get("ICREDIT_GROUP_PRIVATE_TOKEN");
    const redirectUrl = Deno.env.get("ICREDIT_REDIRECT_URL");
    const ipnUrl = Deno.env.get("ICREDIT_IPN_URL");
    const failureIpnUrl = Deno.env.get("ICREDIT_FAILURE_IPN_URL") || ipnUrl;
    if (!groupPrivateToken || !redirectUrl || !ipnUrl || !failureIpnUrl) {
      throw new HttpError(500, "iCredit TEST enrollment is not configured");
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "invalid JSON body");
    }
    const membershipId = String(body.membershipId ?? "").trim();
    if (!membershipId) throw new HttpError(400, "missing membershipId");

    const { data: membershipData, error: membershipError } = await adminClient
      .from("club_memberships")
      .select(`
        id, monthly_price, billing_day, starts_on, status,
        club:clubs!inner(id, name),
        participant:club_participants!inner(
          first_name, last_name, phone, email,
          primary_contact_phone, primary_contact_email
        )
      `)
      .eq("id", membershipId)
      .single();
    if (membershipError || !membershipData) throw new HttpError(404, "membership not found");
    const membership = membershipData as unknown as MembershipRow;
    if (["cancelled", "ended"].includes(membership.status)) {
      throw new HttpError(409, "membership cannot be enrolled");
    }

    const { data: existing, error: existingError } = await adminClient
      .from("recurring_agreements")
      .select("id, status, enrollment_url")
      .eq("membership_id", membershipId)
      .maybeSingle();
    if (existingError) throw new HttpError(500, "could not load recurring agreement");
    if (existing?.status === "active") {
      throw new HttpError(409, "recurring agreement is already active");
    }
    if (existing?.status === "cancelled") {
      throw new HttpError(409, "cancelled recurring agreements cannot be restarted");
    }
    if (existing?.enrollment_url) {
      const existingUrl = readEnrollmentResponse({ Status: 0, URL: existing.enrollment_url });
      return json({ ok: true, agreementId: existing.id, url: existingUrl, reused: true });
    }

    const agreementId = existing?.id || crypto.randomUUID();
    if (!existing) {
      const { error: agreementError } = await adminClient
        .from("recurring_agreements")
        .insert({
          id: agreementId,
          membership_id: membership.id,
          provider_environment: "test",
          provider_request_reference: `club:${agreementId}`,
          recurring_day: membership.billing_day,
          starts_on: membership.starts_on,
        });
      if (agreementError) throw new HttpError(500, "could not create recurring agreement");

      const { error: membershipUpdateError } = await adminClient
        .from("club_memberships")
        .update({ payment_status: "enrollment_pending" })
        .eq("id", membership.id);
      if (membershipUpdateError) throw new HttpError(500, "could not mark enrollment pending");
    }

    const participant = membership.participant;
    const payload = buildEnrollmentRequest({
      groupPrivateToken,
      agreementId,
      clubName: membership.club.name,
      amount: Number(membership.monthly_price),
      billingDay: membership.billing_day,
      startsOn: membership.starts_on,
      firstName: participant.first_name,
      lastName: participant.last_name,
      phone: participant.primary_contact_phone || participant.phone,
      email: participant.primary_contact_email || participant.email,
      redirectUrl,
      ipnUrl,
      failureIpnUrl,
    });

    const providerResponse = await fetch(
      `${ICREDIT_TEST_BASE_URL}/API/PaymentPageRequest.svc/GetUrl`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    let providerData: Record<string, unknown>;
    try {
      providerData = await providerResponse.json();
    } catch {
      throw new HttpError(502, "iCredit returned an unreadable enrollment response");
    }
    if (!providerResponse.ok) throw new HttpError(502, "iCredit enrollment request failed");
    const url = readEnrollmentResponse(providerData);

    const { error: saveUrlError } = await adminClient
      .from("recurring_agreements")
      .update({ enrollment_url: url })
      .eq("id", agreementId)
      .eq("status", "pending_enrollment");
    if (saveUrlError) throw new HttpError(500, "could not save enrollment reference");

    return json({ ok: true, agreementId, url, reused: false });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "unexpected enrollment error";
    return json({ ok: false, error: message }, status);
  }
});
