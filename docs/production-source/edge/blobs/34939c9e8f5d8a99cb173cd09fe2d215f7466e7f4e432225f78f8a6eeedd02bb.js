import {
  DeliveryError,
  destinationFor,
  json,
  publicAttempt,
  readJson,
  revisionForMessage,
  safeProviderId,
  validateSendRequest,
  validId,
} from "./contract.js";
export function createDeliveryHandler(
  { channel, authorize, repository, provider },
) {
  return async (request) => {
    if (request.method === "OPTIONS") return json({ ok: true });
    if (request.method !== "POST") {
      return json({ ok: false, code: "method_not_allowed" }, 405);
    }
    try {
      const caller = await authorize(request), body = await readJson(request);
      if (!validId(body.orderId)) throw new DeliveryError("invalid_request");
      // User-scoped RPC precedes every service-role read and provider inspection.
      const document = await caller.loadDocument(body.orderId);
      if (!document?.can_send) {
        throw new DeliveryError("order_delivery_forbidden", 403);
      }
      if (body.action === "capabilities" && Object.keys(body).length === 2) {
        try {
          revisionForMessage(document.data);
        } catch {
          return json({
            ok: true,
            canSend: false,
            reason: "invalid_saved_order",
          });
        }
        return json({ ok: true, ...await provider.capabilities() });
      }
      const input = await validateSendRequest(body), actorId = caller.actorId;
      if (channel === "whatsapp" && input.recipient !== undefined) {
        throw new DeliveryError("invalid_request");
      }
      const existing = await repository.getAttempt(input.requestId);
      if (existing) {
        const destination = input.recipient === undefined
          ? existing.destination
          : destinationFor(channel, {}, input.recipient);
        if (
          existing.actor_id !== actorId ||
          (existing.resend_of ?? null) !== input.resendOf ||
          existing.order_id !== input.orderId ||
          existing.version !== input.version || existing.channel !== channel ||
          existing.pdf_sha256 !== input.pdfHash ||
          existing.destination !== destination
        ) throw new DeliveryError("delivery_request_conflict", 409);
        return json({
          ok: true,
          attempt: publicAttempt(existing),
          replayed: true,
        });
      }
      if (document.version !== input.version) {
        throw new DeliveryError("order_version_stale", 409);
      }
      revisionForMessage(document.data);
      input.destination = destinationFor(
        channel,
        document.data,
        input.recipient,
      );
      const capabilities = await provider.capabilities();
      if (!capabilities.canSend) {
        throw new DeliveryError(
          capabilities.reason || "delivery_not_configured",
          503,
        );
      }
      const claim = await repository.claim(input, channel, actorId);
      if (!claim.claimed) {
        return json({
          ok: true,
          attempt: publicAttempt(claim.attempt),
          replayed: true,
        });
      }
      let state = "accepted", reason = null, providerId = null;
      try {
        providerId = safeProviderId(
          await provider.send({
            ...revisionForMessage(claim.revision),
            destination: claim.attempt.destination,
            pdfBytes: input.pdfBytes,
          }),
        );
        if (!providerId) {
          throw new DeliveryError(
            "provider_response_uncertain",
            502,
            "uncertain",
          );
        }
      } catch (error) {
        state = error instanceof DeliveryError && error.state === "failed"
          ? "failed"
          : "uncertain";
        reason = error instanceof DeliveryError &&
            [
              "provider_rejected",
              "provider_timeout",
              "provider_unavailable",
              "provider_response_uncertain",
            ].includes(error.code)
          ? error.code
          : "provider_unavailable";
        providerId = null;
      }
      let attempt;
      try {
        attempt = await repository.finish(
          input.requestId,
          actorId,
          state,
          reason,
          providerId,
        );
      } catch {
        attempt = {
          ...claim.attempt,
          state: "uncertain",
          reason: "provider_response_uncertain",
        };
      }
      return json({
        ok: true,
        attempt: publicAttempt(attempt),
        replayed: false,
      });
    } catch (error) {
      return json({
        ok: false,
        code: error instanceof DeliveryError
          ? error.code
          : "order_delivery_unavailable",
      }, error instanceof DeliveryError ? error.status : 503);
    }
  };
}
