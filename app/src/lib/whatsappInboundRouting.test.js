import { describe, expect, test, vi } from "vitest";
import { routeInboundWhatsAppEvent } from "../../../supabase/functions/whatsapp-webhook/route-event.js";
import { createWhatsAppSender } from "../../../supabase/functions/whatsapp-webhook/sender.js";

describe("temporary WhatsApp number cutover", () => {
  test.each(["new-id", "old-id"])("routes a verified %s event back through that number", async phoneNumberId => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 }));
    const sender = createWhatsAppSender({ token: "new-token", phoneNumberId: "new-id", fallbackToken: "old-token", fallbackPhoneNumberId: "old-id", fetchImpl });
    const event = { sanitizedMetadata: { phoneNumberId } };
    const processEvent = vi.fn(async (_event, routedSender) => routedSender.sendText({ channel: "whatsapp", to: "972501234567", text: "reply" }));
    await routeInboundWhatsAppEvent({ event, sender, processEvent });
    expect(processEvent).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toContain(`/${phoneNumberId}/messages`);
  });

  test.each([null, "old-id", "unexpected-id"])("ignores an unrecognized or retired number before persistence or sending", async phoneNumberId => {
    const sender = createWhatsAppSender({ token: "new-token", phoneNumberId: "new-id", fetchImpl: vi.fn() });
    const processEvent = vi.fn();
    await expect(routeInboundWhatsAppEvent({ event: { sanitizedMetadata: { phoneNumberId } }, sender, processEvent }))
      .resolves.toEqual({ status: "ignored_unknown_phone" });
    expect(processEvent).not.toHaveBeenCalled();
  });
});
