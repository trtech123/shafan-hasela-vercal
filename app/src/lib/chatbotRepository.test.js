import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChatbotRepository,
  mapConversation,
} from "../../../supabase/functions/_shared/chatbot/repository.js";

describe("chatbot Supabase repository", () => {
  test("uses the service-only atomic claim and preserves denial reasons", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "expired", error: null });
    const repository = createChatbotRepository({ rpc });
    expect(await repository.claimAttachment("message-1")).toBe("expired");
    expect(rpc).toHaveBeenCalledWith("claim_bot_attachment", { p_message_id: "message-1" });
  });
  test("retry list preserves attachment identity but excludes previously failed attachments", async () => {
    const rows = [
      { id: "a", message_kind: "attachment", delivery_status: "pending", asset_id: "carmel", asset_checksum: "a".repeat(64), conversation_id: "c", response_id: "asset.carmel" },
      { id: "b", message_kind: "attachment", delivery_status: "failed" },
      { id: "t", message_kind: "text", delivery_status: "failed", body: "reply" },
    ];
    const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn().mockResolvedValue({ data: rows }) };
    for (const method of ["select", "eq", "in"]) query[method].mockReturnValue(query);
    const repo = createChatbotRepository({ from: vi.fn().mockReturnValue(query) });
    const result = await repo.listRetryableOutbound("event-1");
    expect(result.map((m) => m.id)).toEqual(["a", "t"]);
    expect(result[0]).toMatchObject({ messageKind: "attachment", assetId: "carmel", assetChecksum: "a".repeat(64), conversationId: "c" });
    expect(query.in).toHaveBeenCalledWith("delivery_status", ["pending", "failed"]);
  });
  test("maps persisted state without exposing arbitrary database fields", () => {
    expect(mapConversation({
      id: "conversation-1",
      status: "automated",
      current_state: "menu.main",
      parent_state: null,
      selected_site: "acre_extreme_park",
      selected_activity: null,
      collected_fields: { group_size_bucket: "small" },
      ignored_secret: "do not expose",
    })).toEqual({
      id: "conversation-1",
      status: "automated",
      currentState: "menu.main",
      parentState: null,
      selectedSite: "acre_extreme_park",
      selectedActivity: null,
      collectedFields: { group_size_bucket: "small" },
    });
  });

  test("claims events only through the atomic service-role RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ event_id: "event-1", claimed: true, resumed: false }],
      error: null,
    });
    const repository = createChatbotRepository({ rpc, from: vi.fn() });
    const event = {
      channel: "whatsapp",
      providerEventId: "wamid.1",
      providerMessageId: "wamid.1",
      eventKind: "message",
      payloadDigest: "a".repeat(64),
      occurredAt: "2026-09-08T12:00:00.000Z",
      sanitizedMetadata: { provider: "meta" },
    };

    await expect(repository.claimEvent(event)).resolves.toEqual({ eventId: "event-1", claimed: true, resumed: false });
    expect(rpc).toHaveBeenCalledWith("claim_bot_channel_event", {
      p_channel: "whatsapp",
      p_provider_event_id: "wamid.1",
      p_provider_message_id: "wamid.1",
      p_event_kind: "message",
      p_payload_digest: "a".repeat(64),
      p_occurred_at: "2026-09-08T12:00:00.000Z",
      p_sanitized_metadata: { provider: "meta" },
    });
  });

  test("records only the allowlisted secure-action audit fields", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const repository = createChatbotRepository({ rpc: vi.fn(), from });

    await repository.recordAction({
      conversationId: "conversation-1",
      triggerEventId: "event-1",
      actionId: "resend_order_confirmation",
      idempotencyKey: "event-1:resend_order_confirmation",
      availability: "handoff_only",
      outcome: "handoff_required",
      failureCode: "artifact_persistence_unavailable",
      total: 999,
    });

    expect(from).toHaveBeenCalledWith("bot_action_events");
    expect(insert).toHaveBeenCalledWith({
      conversation_id: "conversation-1",
      trigger_event_id: "event-1",
      action_id: "resend_order_confirmation",
      idempotency_key: "event-1:resend_order_confirmation",
      availability: "handoff_only",
      outcome: "handoff_required",
      failure_code: "artifact_persistence_unavailable",
    });
  });

  test("contains no access path to protected business domains", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, "../../../supabase/functions/_shared/chatbot/repository.js"), "utf8");
    expect(source).not.toMatch(/\.from\(["'](?:orders|quotes|clubs|club_|sales|payment_|accounting_|recurring_)/i);
    expect(source).not.toMatch(/\.rpc\(["'](?:.*order.*|.*quote.*|.*payment.*|.*club.*)/i);
  });
});
