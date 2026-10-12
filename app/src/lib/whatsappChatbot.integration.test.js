import { describe, expect, test, vi } from "vitest";
import { createWhatsAppWebhookHandler } from "../../../supabase/functions/whatsapp-webhook/handler.js";
import { processVerifiedEvent } from "../../../supabase/functions/_shared/chatbot/process-event.js";
import { approvedContent, resolveResponse } from "../../../supabase/functions/_shared/chatbot/content.js";
import { createWhatsAppSender } from "../../../supabase/functions/whatsapp-webhook/sender.js";
import { assetManifest } from "../../../supabase/functions/_shared/chatbot/assets.js";

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
    releaseStaleHandoff: async () => null,
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
    async createHandoff(handoff) {
      handoffs.push(handoff);
      for (const conversation of conversations.values()) if (conversation.id === handoff.conversationId) conversation.status = "awaiting_human";
      return { handoffId: `handoff-${handoffs.length}`, leadId: `lead-${handoffs.length}` };
    },
    async recordAction() {},
    async insertOutboundMessage(message) {
      const row = { id: `message-${messages.length + 1}`, ...message, direction: "outbound" };
      messages.push(row);
      return row;
    },
    async updateOutboundDelivery() {},
    async claimAttachment(id) {
      const message = messages.find((row) => row.id === id);
      if (!message || message.attempted) return "unavailable";
      message.attempted = true;
      return "claimed";
    },
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

test("signed natural entry and invalid choices preserve flow; replay never repeats sends or handoffs", async () => {
  const repository = createMemoryRepository();
  const sender = {
    sendText: vi.fn(async () => ({ providerMessageId: "text-test" })),
    sendAttachment: vi.fn(async () => ({ providerMessageId: "attachment-test" })),
  };
  const handler = createWhatsAppWebhookHandler({ appSecret, verifyToken: "test-token",
    processEvent: (event) => processVerifiedEvent({ event, repository, sender }) });
  const from = "972500000099";
  const steps = [
    ["הי", "menu.main", 0, 0],
    ["טקסט חופשי", "menu.main", 0, 0],
    ["🙂", "menu.main", 0, 0],
    ["2", "menu.corporate_topics", 0, 0],
    ["99", "menu.corporate_topics", 0, 0],
    ["בחירה לא מובנת", "menu.corporate_topics", 0, 0],
    ["8", "menu.corporate_group_size", 1, 0],
    ["8", "menu.corporate_group_size", 1, 0],
    ["טעות", "menu.corporate_group_size", 1, 0],
    ["1", "menu.corporate_group_size", 1, 1],
  ];
  for (const [index, [text, state, attachments, handoffs]] of steps.entries()) {
    const body = payload(`natural-${index}`, from, text);
    expect((await post(handler, body)).status).toBe(200);
    expect(repository.state.conversations.get(from).currentState).toBe(state);
    expect(sender.sendAttachment).toHaveBeenCalledTimes(attachments);
    expect(repository.state.handoffs).toHaveLength(handoffs);
    const sends = sender.sendText.mock.calls.length;
    const messages = repository.state.messages.length;
    expect((await post(handler, body)).status).toBe(200);
    expect(sender.sendText).toHaveBeenCalledTimes(sends);
    expect(sender.sendAttachment).toHaveBeenCalledTimes(attachments);
    expect(repository.state.messages).toHaveLength(messages);
    expect(repository.state.handoffs).toHaveLength(handoffs);
  }
  expect(sender.sendAttachment).toHaveBeenCalledWith(expect.objectContaining({ assetId: "berko_treasure" }));
  expect(repository.state.handoffs[0]).toMatchObject({ reason: "quote_request", capture: {
    requested_activity: "berko_treasure", requested_site: "berko_360_tiberias", group_size_bucket: "small",
  } });
  expect(repository.state.conversations.get(from).status).toBe("awaiting_human");
  const sends = sender.sendText.mock.calls.length;
  await post(handler, payload("locked-natural", from, "הי"));
  expect(sender.sendText).toHaveBeenCalledTimes(sends);
  expect(repository.state.handoffs).toHaveLength(1);
});

describe("signed WhatsApp chatbot integration", () => {
  test.each(assetManifest.map((a, i) => [a.id, String(i + 1)]))("signed selection delivers only %s, concurrent replay has no second media send", async (assetId, choice) => {
    const repository = createMemoryRepository();
    const loadAsset = vi.fn(async (id) => ({ asset: assetManifest.find((a) => a.id === id), blob: new Blob(["fixture"]) }));
    const fetchImpl = vi.fn(async (url) => new Response(JSON.stringify(url.endsWith("/media") ? { id: "media-1" } : { messages: [{ id: `out-${fetchImpl.mock.calls.length}` }] })));
    const sender = createWhatsAppSender({ token: "test-only", phoneNumberId: "phone-1", fetchImpl, loadAsset });
    const handler = createWhatsAppWebhookHandler({ appSecret, verifyToken: "verify", processEvent: (event) => processVerifiedEvent({ event, repository, sender }) });
    await post(handler, payload("d1", "972501111111", "שלום"));
    await post(handler, payload("d2", "972501111111", "2"));
    expect(loadAsset).not.toHaveBeenCalled();
    const selection = payload("d3", "972501111111", choice);
    expect((await Promise.all([post(handler, selection), post(handler, selection)])).map((r) => r.status)).toEqual([200, 200]);
    expect(loadAsset).toHaveBeenCalledExactlyOnceWith(assetId, assetManifest.find((a) => a.id === assetId).sha256);
    const attachments = fetchImpl.mock.calls.filter(([url, init]) => url.endsWith("/messages") && JSON.parse(init.body).type !== "text");
    expect(attachments).toHaveLength(1);
    const body = JSON.parse(attachments[0][1].body);
    expect(body[body.type].id).toBe("media-1");
    expect(body[body.type].link).toBeUndefined();
    await post(handler, payload("d4", "972501111111", "1"));
    expect(repository.state.handoffs[0].capture.requested_activity).toBe(assetId);
    await post(handler, payload("d5", "972501111111", "תפריט"));
    expect(loadAsset).toHaveBeenCalledOnce();
  });
  test("missing private object locks conversation for staff and invalid signatures never reach assets", async () => {
    const repository = createMemoryRepository();
    const loadAsset = vi.fn().mockRejectedValue(new Error("chatbot_asset_unavailable"));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "text" }] })));
    const sender = createWhatsAppSender({ token: "test-only", phoneNumberId: "phone-1", fetchImpl, loadAsset });
    const handler = createWhatsAppWebhookHandler({ appSecret, verifyToken: "verify", processEvent: (event) => processVerifiedEvent({ event, repository, sender }) });
    const invalid = await handler(new Request("https://example.test", { method: "POST", body: JSON.stringify(payload("bad", "972501111111", "1")) }));
    expect(invalid.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    await post(handler, payload("d1", "972501111111", "2"));
    const selection = payload("d2", "972501111111", "1");
    expect((await post(handler, selection)).status).toBe(500);
    expect(repository.state.conversations.get("972501111111").status).toBe("awaiting_human");
    expect(repository.state.handoffs[0].reason).toBe("document_unavailable");
    expect((await post(handler, selection)).status).toBe(200);
    expect(loadAsset).toHaveBeenCalledOnce();
  });
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
