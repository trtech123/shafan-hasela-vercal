const GRAPH_VERSION = "v25.0";

export function createWhatsAppSender({ token, phoneNumberId, fallbackToken, fallbackPhoneNumberId, fetchImpl = fetch }) {
  const acceptsInboundPhoneNumberId = (id) => Boolean(id && (id === phoneNumberId || id === fallbackPhoneNumberId));
  return {
    acceptsInboundPhoneNumberId,
    async sendText({ channel, to, text, sourcePhoneNumberId }) {
      if (!token || !phoneNumberId) throw new Error("whatsapp_not_configured");
      if (sourcePhoneNumberId !== undefined && !acceptsInboundPhoneNumberId(sourcePhoneNumberId)) {
        throw new Error("unrecognized_phone_number_id");
      }
      const useFallback = sourcePhoneNumberId !== undefined && sourcePhoneNumberId === fallbackPhoneNumberId && sourcePhoneNumberId !== phoneNumberId;
      const sendingToken = useFallback ? fallbackToken : token;
      const sendingPhoneNumberId = useFallback ? fallbackPhoneNumberId : phoneNumberId;
      if (!sendingToken) throw new Error("whatsapp_not_configured");
      if (channel !== "whatsapp") throw new Error("unsupported_channel");
      if (!/^\d{8,15}$/u.test(to ?? "")) throw new Error("invalid_recipient");
      if (typeof text !== "string" || text.length === 0 || text.length > 4096) throw new Error("invalid_message");

      const response = await fetchImpl(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(sendingPhoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sendingToken}`,
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
