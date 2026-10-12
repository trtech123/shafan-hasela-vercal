import { describe, expect, test, vi } from "vitest";
import { processVerifiedEvent } from "../../../supabase/functions/_shared/chatbot/process-event.js";
import { assetManifest } from "../../../supabase/functions/_shared/chatbot/assets.js";

function harness() {
  let claimed = false;
  const messages = [];
  const attempts = new Set();
  const repository = {
    releaseStaleHandoff: async () => null,
    claimEvent: vi.fn(async () => { const fresh = !claimed; claimed = true; return { eventId: "e1", claimed: fresh }; }),
    upsertVerifiedContact: vi.fn(async () => ({ id: "contact" })),
    getOrCreateConversation: vi.fn(async () => ({ id: "conversation", status: "automated", currentState: "menu.corporate_topics", collectedFields: {} })),
    insertInboundMessage: vi.fn(), updateConversation: vi.fn(), createHandoff: vi.fn(), recordAction: vi.fn(),
    insertOutboundMessage: vi.fn(async (message) => { const row = { ...message, id: `m${messages.length}` }; messages.push(row); return row; }),
    claimAttachment: vi.fn(async (id) => { if (attempts.has(id)) return false; attempts.add(id); return true; }),
    updateOutboundDelivery: vi.fn(), listRetryableOutbound: vi.fn(async () => messages),
    completeEvent: vi.fn(), failEvent: vi.fn(),
  };
  const sender = {
    sendText: vi.fn(async () => ({ providerMessageId: "text-id" })),
    sendAttachment: vi.fn(async () => ({ providerMessageId: "media-message-id" })),
  };
  const event = { channel: "whatsapp", eventKind: "message", providerEventId: "in1", providerMessageId: "in1", externalContactId: "972501234567", threadId: "972501234567", occurredAt: new Date().toISOString(), input: { text: "1" } };
  return { repository, sender, event, messages };
}

describe("attachment processing and replay boundaries", () => {
  test.each(assetManifest.map((asset, i) => [asset.id, String(i + 1), asset.sha256]))("persists and sends only selected %s", async (assetId, choice, checksum) => {
    const h = harness(); h.event.input.text = choice;
    await processVerifiedEvent(h);
    expect(h.messages[0]).toMatchObject({ messageKind: "attachment", assetId, assetChecksum: checksum, responseId: `asset.${assetId}` });
    expect(h.repository.claimAttachment).toHaveBeenCalledWith("m0");
    expect(h.sender.sendAttachment).toHaveBeenCalledExactlyOnceWith({ channel: "whatsapp", to: h.event.externalContactId, assetId, checksum });
    expect(h.repository.insertOutboundMessage.mock.invocationCallOrder[0]).toBeLessThan(h.repository.claimAttachment.mock.invocationCallOrder[0]);
    expect(h.repository.claimAttachment.mock.invocationCallOrder[0]).toBeLessThan(h.sender.sendAttachment.mock.invocationCallOrder[0]);
    expect(h.sender.sendText).toHaveBeenCalledOnce();
    expect(h.repository.recordAction).not.toHaveBeenCalled();
  });
  test("repeated webhook never sends twice", async () => {
    const h = harness(); await processVerifiedEvent(h); await processVerifiedEvent(h);
    expect(h.sender.sendAttachment).toHaveBeenCalledOnce();
    expect(h.repository.insertInboundMessage).toHaveBeenCalledOnce();
  });
  test("replayed pending intent must acquire a fresh atomic attachment claim", async () => {
    const h = harness(); await processVerifiedEvent(h);
    h.repository.claimEvent.mockResolvedValue({ eventId: "e1", claimed: true, resumed: true });
    await processVerifiedEvent(h);
    expect(h.sender.sendAttachment).toHaveBeenCalledOnce();
  });
  test.each([false, true])("attachment failure (uncertain=%s) records terminal state and human handoff", async (uncertain) => {
    const h = harness(); h.sender.sendAttachment.mockRejectedValue(Object.assign(new Error("do not expose this"), { uncertain }));
    await expect(processVerifiedEvent(h)).rejects.toThrow("chatbot_attachment");
    expect(h.repository.updateOutboundDelivery).toHaveBeenCalledWith("m0", { status: uncertain ? "uncertain" : "failed" });
    expect(h.repository.failEvent).toHaveBeenCalledWith("e1", uncertain ? "attachment_uncertain" : "attachment_failed");
    expect(h.repository.createHandoff).toHaveBeenCalledWith(expect.objectContaining({ reason: uncertain ? "document_delivery_uncertain" : "document_unavailable" }));
    expect(h.sender.sendText).not.toHaveBeenCalled();
    await processVerifiedEvent(h);
    expect(h.sender.sendAttachment).toHaveBeenCalledOnce();
  });
  test("accepted send followed by persistence failure is uncertain and never retried", async () => {
    const h = harness(); h.repository.updateOutboundDelivery.mockRejectedValueOnce(new Error("database down"));
    await expect(processVerifiedEvent(h)).rejects.toThrow("chatbot_attachment_uncertain");
    expect(h.repository.failEvent).toHaveBeenCalledWith("e1", "attachment_uncertain");
    expect(h.repository.updateOutboundDelivery).toHaveBeenLastCalledWith("m0", { status: "uncertain" });
  });
  test("claim denial from lock, stale event or prior attempt prevents media operations", async () => {
    const h = harness(); h.repository.claimAttachment.mockResolvedValue(false);
    await processVerifiedEvent(h);
    expect(h.sender.sendAttachment).not.toHaveBeenCalled();
  });
  test("expired selection creates a handoff and terminal failure instead of silently completing", async () => {
    const h = harness(); h.repository.claimAttachment.mockResolvedValue("expired");
    await expect(processVerifiedEvent(h)).rejects.toThrow("chatbot_attachment_expired");
    expect(h.sender.sendAttachment).not.toHaveBeenCalled();
    expect(h.sender.sendText).not.toHaveBeenCalled();
    expect(h.repository.completeEvent).not.toHaveBeenCalled();
    expect(h.repository.failEvent).toHaveBeenCalledWith("e1", "attachment_expired");
    expect(h.repository.createHandoff).toHaveBeenCalledWith(expect.objectContaining({ reason: "document_session_expired" }));
  });
  test.each(["awaiting_human", "human_active"])("new selection is suppressed during %s", async (status) => {
    const h = harness(); h.repository.getOrCreateConversation.mockResolvedValue({ id: "conversation", status });
    await processVerifiedEvent(h);
    expect(h.sender.sendAttachment).not.toHaveBeenCalled();
    expect(h.sender.sendText).not.toHaveBeenCalled();
  });
  test("non-WhatsApp selection goes to staff, never to another channel sender", async () => {
    const h = harness(); h.event.channel = "email";
    await processVerifiedEvent(h);
    expect(h.sender.sendAttachment).not.toHaveBeenCalled();
    expect(h.repository.createHandoff).toHaveBeenCalled();
  });
});
