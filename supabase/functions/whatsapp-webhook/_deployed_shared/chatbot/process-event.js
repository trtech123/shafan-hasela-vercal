import { approvedContent, resolveResponse } from "./content.js";
import { advance } from "./state-machine.js";
import { getAsset } from "./assets.js";
import { deliverAttachment } from "./deliver-attachment.js";

const AUTOMATION_LOCKS = new Set(["awaiting_human", "human_active"]);

async function deliverMessages({ event, eventId, messages, repository, sender }) {
  for (const message of messages) {
    if (message.messageKind === "attachment") {
      if (!await deliverAttachment({ event, message, repository, sender })) return;
      continue;
    }
    try {
      const delivery = await sender.sendText({
        channel: event.channel,
        to: event.externalContactId,
        text: message.body,
      });
      await repository.updateOutboundDelivery(message.id, {
        status: "accepted",
        providerMessageId: delivery.providerMessageId,
      });
    } catch (error) {
      await repository.updateOutboundDelivery(message.id, { status: "failed" });
      error.chatbotFailureCode = "send_failed";
      throw error;
    }
  }
}

async function retryDelivery({ event, eventId, repository, sender }) {
  const messages = await repository.listRetryableOutbound(eventId);
  await deliverMessages({ event, eventId, messages, repository, sender });
  await repository.completeEvent(eventId);
  return { status: "retried", eventId, replies: messages.length };
}

function sessionFromConversation(conversation) {
  return {
    status: conversation.status,
    currentState: conversation.currentState,
    parentState: conversation.parentState ?? null,
    selectedSite: conversation.selectedSite ?? null,
    selectedActivity: conversation.selectedActivity ?? null,
    collectedFields: conversation.collectedFields ?? {},
  };
}

export async function processVerifiedEvent({
  event,
  repository,
  sender,
  content = approvedContent,
}) {
  const claim = await repository.claimEvent(event);
  if (!claim.claimed) return { status: "duplicate", eventId: claim.eventId };
  try {
    if (claim.resumed) return retryDelivery({ event, eventId: claim.eventId, repository, sender });

    if (event.eventKind === "status") {
    await repository.updateDeliveryStatus(
      event.channel,
      event.providerMessageId,
      event.deliveryStatus,
      event.occurredAt,
    );
    await repository.completeEvent(claim.eventId);
    return { status: "status_updated", eventId: claim.eventId };
  }

    const contact = await repository.upsertVerifiedContact({
    channel: event.channel,
    externalContactId: event.externalContactId,
    displayName: event.profileName ?? null,
    verifiedPhone: event.verifiedPhone ?? null,
    verificationSource: event.verificationSource,
    verifiedAt: event.receivedAt ?? new Date().toISOString(),
  });
  const conversation = await repository.getOrCreateConversation({
    contactId: contact.id,
    channel: event.channel,
    threadId: event.threadId,
    contentVersion: content.profile.content_version,
    occurredAt: event.occurredAt,
  });

  await repository.insertInboundMessage({
    conversationId: conversation.id,
    triggerEventId: claim.eventId,
    channel: event.channel,
    providerMessageId: event.providerMessageId,
    messageKind: event.messageKind,
    body: event.input?.text ?? null,
    occurredAt: event.occurredAt,
    sanitizedMetadata: event.sanitizedMetadata ?? {},
  });

  if (AUTOMATION_LOCKS.has(conversation.status)) {
    if (event.channel === "whatsapp") {
      const reset = await repository.releaseStaleHandoff(conversation.id, claim.eventId,
        `${content.handoff.stale_reset_response}\n\n${resolveResponse(content, "menu.main")}`);
      if (reset) {
        // One reset send per claimed event. Uncertain sends are never replayed automatically.
        try {
          await repository.updateOutboundDelivery(reset.id, { status: "sending" });
          const delivery = await sender.sendText({ channel: event.channel, to: event.externalContactId, text: reset.body });
          await repository.updateOutboundDelivery(reset.id, { status: "accepted", providerMessageId: delivery.providerMessageId });
        } catch {
          const error = Object.assign(new Error("chatbot_handoff_reset_uncertain"), { chatbotFailureCode: "handoff_reset_uncertain" });
          try { await repository.updateOutboundDelivery(reset.id, { status: "uncertain" }); } catch { /* Preserve terminal failure classification. */ }
          throw error;
        }
        await repository.completeEvent(claim.eventId);
        return { status: "handoff_released", eventId: claim.eventId, conversationId: conversation.id };
      }
    }
    await repository.completeEvent(claim.eventId);
    return { status: "locked", eventId: claim.eventId, conversationId: conversation.id };
  }

  const result = advance({
    content,
    session: sessionFromConversation(conversation),
    input: event.input ?? {},
  });
  if (result.actions.some((action) => action.type === "send_attachment"
    && (event.channel !== "whatsapp" || !getAsset(action.assetId)))) {
    result.session.status = "awaiting_human";
    result.actions = [
      { type: "send", responseId: "handoff.transfer" },
      { type: "handoff", reason: "document_unavailable", priority: "normal", summary: "document_unavailable" },
    ];
  }
  await repository.updateConversation(conversation.id, result.session, event.occurredAt);

  const handoff = result.actions.find((action) => action.type === "handoff");
  if (handoff) {
    await repository.createHandoff({
      conversationId: conversation.id,
      reason: handoff.reason,
      priority: handoff.priority,
      summary: handoff.summary,
      capture: result.session.collectedFields,
    });
  }

  for (const action of result.actions.filter((item) => item.type === "request_secure_action")) {
    await repository.recordAction({
      conversationId: conversation.id,
      triggerEventId: claim.eventId,
      actionId: action.actionId,
      idempotencyKey: `${claim.eventId}:${action.actionId}`,
      availability: "handoff_only",
      outcome: "handoff_required",
      failureCode: "artifact_persistence_unavailable",
    });
  }

  const outboundMessages = [];
  for (const action of result.actions.filter((item) => item.type === "send" || item.type === "send_attachment")) {
    const asset = action.type === "send_attachment" ? getAsset(action.assetId) : null;
    const body = asset ? asset.title : resolveResponse(content, action.responseId);
    outboundMessages.push(await repository.insertOutboundMessage({
      conversationId: conversation.id,
      triggerEventId: claim.eventId,
      channel: event.channel,
      messageKind: asset ? "attachment" : "text",
      ...(asset ? { assetId: asset.id, assetChecksum: asset.sha256 } : {}),
      body,
      responseId: asset ? `asset.${asset.id}` : action.responseId,
      occurredAt: new Date().toISOString(),
    }));
  }

  await deliverMessages({
    event,
    eventId: claim.eventId,
    messages: outboundMessages,
    repository,
    sender,
  });
  await repository.completeEvent(claim.eventId);

    return {
      status: "processed",
      eventId: claim.eventId,
      replies: outboundMessages.length,
      handedOff: Boolean(handoff),
    };
  } catch (error) {
    await repository.failEvent(claim.eventId, error?.chatbotFailureCode ?? "processing_failed");
    throw error;
  }
}
