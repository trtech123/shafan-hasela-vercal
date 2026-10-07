const GRAPH_VERSION = "v25.0";

export function createWhatsAppSender({ token, phoneNumberId, fetchImpl = fetch }) {
  return {
    async sendText({ channel, to, text }) {
      if (!token || !phoneNumberId) throw new Error("whatsapp_not_configured");
      if (channel !== "whatsapp") throw new Error("unsupported_channel");
      if (!/^\d{8,15}$/u.test(to ?? "")) throw new Error("invalid_recipient");
      if (typeof text !== "string" || text.length === 0 || text.length > 4096) throw new Error("invalid_message");

      const response = await fetchImpl(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "text",
            text: { preview_url: false, body: text },
          }),
        },
      );

      if (!response.ok) throw new Error("whatsapp_send_failed");
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("whatsapp_send_failed");
      }
      const providerMessageId = result?.messages?.[0]?.id;
      if (!providerMessageId) throw new Error("whatsapp_send_failed");
      return { providerMessageId };
    },
  };
}
