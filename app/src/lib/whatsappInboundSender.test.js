import { describe, expect, test, vi } from "vitest";
import { createWhatsAppSender } from "../../../supabase/functions/whatsapp-webhook/sender.js";

describe("WhatsApp inbound reply sender", () => {
  test("sends deterministic session text directly to the verified sender id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.out.1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const sender = createWhatsAppSender({ token: "secret-token", phoneNumberId: "phone-1", fetchImpl });

    await expect(sender.sendText({ channel: "whatsapp", to: "972501234567", text: "תוכן מאושר" }))
      .resolves.toEqual({ providerMessageId: "wamid.out.1" });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v25.0/phone-1/messages");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "972501234567",
      type: "text",
      text: { preview_url: false, body: "תוכן מאושר" },
    });
  });

  test("rejects other channels, invalid recipients, and unconfigured credentials", async () => {
    const configured = createWhatsAppSender({ token: "token", phoneNumberId: "phone-1", fetchImpl: vi.fn() });
    await expect(configured.sendText({ channel: "email", to: "a@example.com", text: "hello" })).rejects.toThrow("unsupported_channel");
    await expect(configured.sendText({ channel: "whatsapp", to: "not-a-phone", text: "hello" })).rejects.toThrow("invalid_recipient");

    const missing = createWhatsAppSender({ token: "", phoneNumberId: "", fetchImpl: vi.fn() });
    await expect(missing.sendText({ channel: "whatsapp", to: "972501234567", text: "hello" })).rejects.toThrow("whatsapp_not_configured");
  });

  test("fails without leaking the provider response or access token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "provider secret detail" } }), { status: 400 }));
    const sender = createWhatsAppSender({ token: "secret-token", phoneNumberId: "phone-1", fetchImpl });

    await expect(sender.sendText({ channel: "whatsapp", to: "972501234567", text: "hello" }))
      .rejects.toThrow("whatsapp_send_failed");
    await expect(sender.sendText({ channel: "whatsapp", to: "972501234567", text: "hello" }))
      .rejects.not.toThrow(/provider secret detail|secret-token/);
  });

  test("uses the inbound number and its own token during a temporary cutover", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 }));
    const sender = createWhatsAppSender({
      token: "new-token", phoneNumberId: "new-id",
      fallbackToken: "old-token", fallbackPhoneNumberId: "old-id", fetchImpl,
    });
    await sender.sendText({ channel: "whatsapp", to: "972501234567", text: "reply", sourcePhoneNumberId: "old-id" });
    expect(fetchImpl.mock.calls[0][0]).toContain("/old-id/messages");
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer old-token");
    await sender.sendText({ channel: "whatsapp", to: "972501234567", text: "proactive" });
    expect(fetchImpl.mock.calls[1][0]).toContain("/new-id/messages");
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer new-token");
  });

  test("rejects unknown inbound numbers and fails closed for an uncredentialed fallback", async () => {
    const fetchImpl = vi.fn();
    const sender = createWhatsAppSender({ token: "new-token", phoneNumberId: "new-id", fallbackPhoneNumberId: "old-id", fetchImpl });
    expect(sender.acceptsInboundPhoneNumberId("new-id")).toBe(true);
    expect(sender.acceptsInboundPhoneNumberId("old-id")).toBe(true);
    expect(sender.acceptsInboundPhoneNumberId(null)).toBe(false);
    await expect(sender.sendText({ channel: "whatsapp", to: "972501234567", text: "reply", sourcePhoneNumberId: "old-id" }))
      .rejects.toThrow("whatsapp_not_configured");
    await expect(sender.sendText({ channel: "whatsapp", to: "972501234567", text: "reply", sourcePhoneNumberId: "unexpected-id" }))
      .rejects.toThrow("unrecognized_phone_number_id");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
