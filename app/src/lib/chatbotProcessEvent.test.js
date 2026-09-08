import { describe, expect, test, vi } from "vitest";
import { processVerifiedEvent } from "../../../supabase/functions/_shared/chatbot/process-event.js";

const baseEvent = {
  channel: "whatsapp",
  providerEventId: "wamid.in.1",
  providerMessageId: "wamid.in.1",
  eventKind: "message",
  payloadDigest: "a".repeat(64),
  occurredAt: "2026-09-08T12:00:00.000Z",
  externalContactId: "972501234567",
  threadId: "972501234567",
  profileName: "לקוח בדיקה",
  verifiedPhone: "+972501234567",
  verificationSource: "meta_whatsapp_signed_webhook",
  messageKind: "text",
  input: { text: "שלום" },
  sanitizedMetadata: { provider: "meta" },
};

function makeRepo(overrides = {}) {
  let outboundId = 0;
  return {
    claimEvent: vi.fn().mockResolvedValue({ eventId: "event-1", claimed: true, resumed: false }),
    upsertVerifiedContact: vi.fn().mockResolvedValue({ id: "contact-1", externalContactId: baseEvent.externalContactId }),
    getOrCreateConversation: vi.fn().mockResolvedValue({
      id: "conversation-1",
      status: "automated",
      currentState: "start",
      parentState: null,
      selectedSite: null,
      selectedActivity: null,
      collectedFields: {},
    }),
    insertInboundMessage: vi.fn().mockResolvedValue({ id: "inbound-1" }),
    updateConversation: vi.fn().mockResolvedValue(undefined),
    createHandoff: vi.fn().mockResolvedValue({ handoffId: "handoff-1", leadId: "lead-1" }),
    recordAction: vi.fn().mockResolvedValue(undefined),
    insertOutboundMessage: vi.fn().mockImplementation(async ({ body, responseId }) => ({ id: `outbound-${++outboundId}`, body, responseId })),
    updateOutboundDelivery: vi.fn().mockResolvedValue(undefined),
    listRetryableOutbound: vi.fn().mockResolvedValue([]),
    updateDeliveryStatus: vi.fn().mockResolvedValue(undefined),
    completeEvent: vi.fn().mockResolvedValue(undefined),
    failEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("verified chatbot event processor", () => {
  test("persists inbound and state before sending deterministic replies", async () => {
    const order = [];
    const repository = makeRepo({
      insertInboundMessage: vi.fn().mockImplementation(async () => { order.push("inbound"); return { id: "inbound-1" }; }),
      updateConversation: vi.fn().mockImplementation(async () => { order.push("state"); }),
      insertOutboundMessage: vi.fn().mockImplementation(async ({ body, responseId }) => {
        order.push(`intent:${responseId}`);
        return { id: `outbound-${responseId}`, body, responseId };
      }),
    });
    const sender = { sendText: vi.fn().mockImplementation(async () => { order.push("send"); return { providerMessageId: "wamid.out" }; }) };

    const result = await processVerifiedEvent({ event: baseEvent, repository, sender });

    expect(result).toEqual({ status: "processed", eventId: "event-1", replies: 2, handedOff: false });
    expect(order.slice(0, 3)).toEqual(["inbound", "state", "intent:policy.welcome"]);
    expect(order.indexOf("send")).toBeGreaterThan(order.indexOf("intent:policy.welcome"));
    expect(repository.upsertVerifiedContact).toHaveBeenCalledWith(expect.objectContaining({
      verificationSource: "meta_whatsapp_signed_webhook",
      verifiedPhone: "+972501234567",
    }));
    expect(repository.completeEvent).toHaveBeenCalledWith("event-1");
  });

  test("does nothing for a duplicate provider event", async () => {
    const repository = makeRepo({
      claimEvent: vi.fn().mockResolvedValue({ eventId: "event-1", claimed: false, resumed: false }),
    });
    const sender = { sendText: vi.fn() };

    await expect(processVerifiedEvent({ event: baseEvent, repository, sender }))
      .resolves.toEqual({ status: "duplicate", eventId: "event-1" });
    expect(repository.upsertVerifiedContact).not.toHaveBeenCalled();
    expect(sender.sendText).not.toHaveBeenCalled();
  });

  test("records a handoff and CRM lead link before sending the transfer response", async () => {
    const order = [];
    const repository = makeRepo({
      getOrCreateConversation: vi.fn().mockResolvedValue({
        id: "conversation-1", status: "automated", currentState: "menu.main", parentState: null, collectedFields: {},
      }),
      createHandoff: vi.fn().mockImplementation(async () => { order.push("handoff"); return { handoffId: "handoff-1", leadId: "lead-1" }; }),
      insertOutboundMessage: vi.fn().mockImplementation(async ({ body, responseId }) => {
        order.push(`intent:${responseId}`);
        return { id: "outbound-1", body, responseId };
      }),
    });
    const sender = { sendText: vi.fn().mockImplementation(async () => { order.push("send"); return { providerMessageId: "wamid.out" }; }) };
    const event = { ...baseEvent, input: { text: "כמה עולה?" } };

    const result = await processVerifiedEvent({ event, repository, sender });

    expect(result.handedOff).toBe(true);
    expect(repository.createHandoff).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conversation-1",
      reason: "specific_price",
      summary: "כמה עולה?",
    }));
    expect(order[0]).toBe("handoff");
    expect(order.indexOf("send")).toBeGreaterThan(order.indexOf("handoff"));
  });

  test.each(["awaiting_human", "human_active"])("persists messages but sends nothing while %s", async (status) => {
    const repository = makeRepo({
      getOrCreateConversation: vi.fn().mockResolvedValue({
        id: "conversation-1", status, currentState: "menu.main", parentState: null, collectedFields: {},
      }),
    });
    const sender = { sendText: vi.fn() };

    const result = await processVerifiedEvent({ event: baseEvent, repository, sender });

    expect(result).toEqual({ status: "locked", eventId: "event-1", conversationId: "conversation-1" });
    expect(repository.insertInboundMessage).toHaveBeenCalledOnce();
    expect(repository.updateConversation).not.toHaveBeenCalled();
    expect(sender.sendText).not.toHaveBeenCalled();
  });

  test("updates delivery status callbacks without invoking the engine", async () => {
    const repository = makeRepo();
    const sender = { sendText: vi.fn() };
    const event = {
      ...baseEvent,
      providerEventId: "wamid.out:delivered:1",
      eventKind: "status",
      deliveryStatus: "delivered",
      input: undefined,
    };

    const result = await processVerifiedEvent({ event, repository, sender });

    expect(result.status).toBe("status_updated");
    expect(repository.updateDeliveryStatus).toHaveBeenCalledWith("whatsapp", "wamid.in.1", "delivered", event.occurredAt);
    expect(repository.getOrCreateConversation).not.toHaveBeenCalled();
    expect(sender.sendText).not.toHaveBeenCalled();
  });

  test("retries a failed send without repeating the state transition or inbound insert", async () => {
    const retryMessage = { id: "outbound-1", body: "תשובה מאושרת", responseId: "policy.welcome" };
    const repository = makeRepo({
      claimEvent: vi.fn()
        .mockResolvedValueOnce({ eventId: "event-1", claimed: true, resumed: false })
        .mockResolvedValueOnce({ eventId: "event-1", claimed: true, resumed: true }),
      insertOutboundMessage: vi.fn().mockResolvedValue(retryMessage),
      listRetryableOutbound: vi.fn().mockResolvedValue([retryMessage]),
    });
    const sender = {
      sendText: vi.fn()
        .mockRejectedValueOnce(new Error("Meta unavailable"))
        .mockResolvedValue({ providerMessageId: "wamid.out" }),
    };

    await expect(processVerifiedEvent({ event: baseEvent, repository, sender })).rejects.toThrow("Meta unavailable");
    await expect(processVerifiedEvent({ event: baseEvent, repository, sender }))
      .resolves.toEqual({ status: "retried", eventId: "event-1", replies: 1 });

    expect(repository.insertInboundMessage).toHaveBeenCalledOnce();
    expect(repository.updateConversation).toHaveBeenCalledOnce();
    expect(repository.listRetryableOutbound).toHaveBeenCalledWith("event-1");
    expect(repository.failEvent).toHaveBeenCalledWith("event-1", "send_failed");
    expect(sender.sendText).toHaveBeenCalledTimes(2);
  });

  test("audits order-confirmation intent as unavailable and never returns order data", async () => {
    const repository = makeRepo({
      getOrCreateConversation: vi.fn().mockResolvedValue({
        id: "conversation-1", status: "automated", currentState: "menu.main", parentState: null, collectedFields: {},
      }),
    });
    const sender = { sendText: vi.fn().mockResolvedValue({ providerMessageId: "wamid.out" }) };
    const event = { ...baseEvent, input: { text: "שלחו לי את אישור ההזמנה" } };

    await processVerifiedEvent({ event, repository, sender });

    expect(repository.recordAction).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      triggerEventId: "event-1",
      actionId: "resend_order_confirmation",
      idempotencyKey: "event-1:resend_order_confirmation",
      availability: "handoff_only",
      outcome: "handoff_required",
      failureCode: "artifact_persistence_unavailable",
    });
  });

  test("marks a claimed event retryable when persistence fails before any reply", async () => {
    const repository = makeRepo({
      insertInboundMessage: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    const sender = { sendText: vi.fn() };

    await expect(processVerifiedEvent({ event: baseEvent, repository, sender })).rejects.toThrow("database unavailable");
    expect(repository.failEvent).toHaveBeenCalledWith("event-1", "processing_failed");
    expect(sender.sendText).not.toHaveBeenCalled();
  });
});
