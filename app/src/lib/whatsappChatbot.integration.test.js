import { describe, expect, test, vi } from "vitest";
import { createWhatsAppWebhookHandler } from "../../../supabase/functions/whatsapp-webhook/handler.js";
import { processVerifiedEvent } from "../../../supabase/functions/_shared/chatbot/process-event.js";
import { approvedContent, resolveResponse } from "../../../supabase/functions/_shared/chatbot/content.js";

const appSecret = "integration-secret";

async function signatureFor(body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `sha256=${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function payload(id, from, text) {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "phone-1" },
      contacts: [{ wa_id: from, profile: { name: `לקוח ${from.slice(-2)}` } }],
      messages: [{ id, from, timestamp: "1788872400", type: "text", text: { body: text } }],
    } }] }],
  };
}

function createMemoryRepository() {
  const claimed = new Map();
  const conversations = new Map();
  const messages = [];
  const handoffs = [];
  return {
    state: { conversations, messages, handoffs },
    async claimEvent(event) {
      if (claimed.has(event.providerEventId)) return { eventId: claimed.get(event.providerEventId), claimed: false, resumed: false };
      const eventId = `event-${claimed.size + 1}`;
      claimed.set(event.providerEventId, eventId);
      return { eventId, claimed: true, resumed: false };
    },
    async upsertVerifiedContact(contact) { return { id: `contact-${contact.externalContactId}` }; },
    async getOrCreateConversation({ threadId }) {
      if (!conversations.has(threadId)) conversations.set(threadId, {
        id: `conversation-${threadId}`, status: "automated", currentState: "start", parentState: null,
        selectedSite: null, selectedActivity: null, collectedFields: {},
      });
      return { ...conversations.get(threadId) };
    },
    async insertInboundMessage(message) { messages.push({ ...message, direction: "inbound" }); return { id: `message-${messages.length}` }; },
    async updateConversation(id, session) {
      const key = [...conversations.entries()].find(([, value]) => value.id === id)?.[0];
      conversations.set(key, { id, ...session });
    },
    async createHandoff(handoff) { handoffs.push(handoff); return { handoffId: `handoff-${handoffs.length}`, leadId: `lead-${handoffs.length}` }; },
    async recordAction() {},
    async insertOutboundMessage(message) {
      const row = { id: `message-${messages.length + 1}`, ...message, direction: "outbound" };
      messages.push(row);
      return row;
    },
    async updateOutboundDelivery() {},
    async listRetryableOutbound() { return []; },
    async updateDeliveryStatus() {},
    async completeEvent() {},
    async failEvent() {},
  };
}

async function post(handler, bodyObject) {
  const body = JSON.stringify(bodyObject);
  return handler(new Request("https://example.test/functions/v1/whatsapp-webhook", {
    method: "POST",
    headers: { "x-hub-signature-256": await signatureFor(body) },
    body,
  }));
}

describe("signed WhatsApp chatbot integration", () => {
  test("runs activity navigation end to end and deduplicates a replay", async () => {
    const repository = createMemoryRepository();
    const sender = { sendText: vi.fn().mockImplementation(async () => ({ providerMessageId: `out-${sender.sendText.mock.calls.length}` })) };
    const handler = createWhatsAppWebhookHandler({
      appSecret,
      verifyToken: "verify",
      processEvent: (event) => processVerifiedEvent({ event, repository, sender }),
    });

    await post(handler, payload("m1", "972501111111", "שלום"));
    await post(handler, payload("m2", "972501111111", "1"));
    await post(handler, payload("m3", "972501111111", "1"));
    const finalResponse = await post(handler, payload("m4", "972501111111", "1"));
    const sendsBeforeReplay = sender.sendText.mock.calls.length;
    const replayResponse = await post(handler, payload("m4", "972501111111", "1"));

    expect(finalResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    expect(sender.sendText).toHaveBeenCalledWith(expect.objectContaining({
      text: resolveResponse(approvedContent, "activity.acre_climbing"),
    }));
    expect(sender.sendText).toHaveBeenCalledTimes(sendsBeforeReplay);
    expect(repository.state.handoffs).toHaveLength(0);
  });

  test("locks automation after a pricing handoff", async () => {
    const repository = createMemoryRepository();
    const sender = { sendText: vi.fn().mockResolvedValue({ providerMessageId: "out-1" }) };
    const handler = createWhatsAppWebhookHandler({
      appSecret,
      verifyToken: "verify",
      processEvent: (event) => processVerifiedEvent({ event, repository, sender }),
    });

    await post(handler, payload("p1", "972502222222", "שלום"));
    await post(handler, payload("p2", "972502222222", "3"));
    const sendsAtHandoff = sender.sendText.mock.calls.length;
    await post(handler, payload("p3", "972502222222", "תפריט"));

    expect(repository.state.handoffs).toHaveLength(1);
    expect(repository.state.handoffs[0].reason).toBe("quote_request");
    expect(repository.state.conversations.get("972502222222").status).toBe("awaiting_human");
    expect(sender.sendText).toHaveBeenCalledTimes(sendsAtHandoff);
    expect(repository.state.messages.filter((message) => message.direction === "inbound")).toHaveLength(3);
  });
});
