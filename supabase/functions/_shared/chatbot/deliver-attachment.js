import { getAsset } from "./assets.js";

// An atomic, durable claim precedes all provider work. Once claimed, an attachment
// is never automatically retried, even if the process crashes before recording an ID.
export async function deliverAttachment({ event, message, repository, sender }) {
  const claim = await repository.claimAttachment(message.id);
  if (claim !== true && claim !== "claimed" && claim !== "expired") return false;
  let accepted = false;
  try {
    if (claim === "expired") throw new Error("attachment_expired");
    const asset = getAsset(message.assetId);
    if (!asset || asset.sha256 !== message.assetChecksum) throw new Error("chatbot_asset_unavailable");
    const delivery = await sender.sendAttachment({
      channel: event.channel,
      to: event.externalContactId,
      assetId: asset.id,
      checksum: message.assetChecksum,
    });
    accepted = true;
    await repository.updateOutboundDelivery(message.id, { status: "accepted", providerMessageId: delivery.providerMessageId });
    return true;
  } catch (error) {
    const uncertain = accepted || error?.uncertain === true;
    const code = claim === "expired" ? "attachment_expired" : uncertain ? "attachment_uncertain" : "attachment_failed";
    // Keep a durable 'sending' claim if recording the terminal outcome fails.
    // Neither state is eligible for automatic replay.
    try {
      await repository.updateOutboundDelivery(message.id, { status: uncertain ? "uncertain" : "failed" });
    } catch { /* durable claim remains; staff reconcile the attempt */ }
    try {
      await repository.createHandoff({
        conversationId: message.conversationId,
        reason: claim === "expired" ? "document_session_expired" : uncertain ? "document_delivery_uncertain" : "document_unavailable",
        priority: "normal",
        summary: `${code}:${message.assetId}`,
        capture: { requested_activity: message.assetId },
      });
    } catch { /* failEvent still records a non-retryable operational error */ }
    throw Object.assign(new Error(`chatbot_${code}`), { chatbotFailureCode: code });
  }
}
