const GRAPH_VERSION = "v25.0";

function attachmentError(uncertain = false) {
  return Object.assign(new Error(uncertain ? "whatsapp_attachment_uncertain" : "whatsapp_attachment_failed"), { uncertain });
}

export function createWhatsAppSender({ token, phoneNumberId, fetchImpl = fetch, loadAsset }) {
  return {
    async sendAttachment({ channel, to, assetId, checksum }) {
      if (!token || !phoneNumberId) throw new Error("whatsapp_not_configured");
      if (channel !== "whatsapp") throw new Error("unsupported_channel");
      if (!/^\d{8,15}$/u.test(to ?? "")) throw new Error("invalid_recipient");
      if (!loadAsset) throw new Error("chatbot_asset_unavailable");
      const { asset, blob } = await loadAsset(assetId, checksum);
      const base = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}`;
      const headers = { Authorization: `Bearer ${token}` };
      let mediaId;
      try {
        const form = new FormData();
        form.append("messaging_product", "whatsapp");
        form.append("type", asset.mimeType);
        form.append("file", blob, asset.filename);
        const upload = await fetchImpl(`${base}/media`, {
          method: "POST", headers, body: form, signal: AbortSignal.timeout(30_000), redirect: "error",
        });
        if (!upload.ok) throw new Error();
        mediaId = (await upload.json())?.id;
        if (typeof mediaId !== "string" || !mediaId) throw new Error();
      } catch {
        // Uploading a media object cannot itself deliver a customer message.
        throw attachmentError(false);
      }
      const media = {
        id: mediaId,
        caption: `${asset.title}\nהעלון כולל מידע על הפעילות ואינו אישור זמינות או הזמנה. לתיאום יש לפנות לנציג.`,
        ...(asset.messageType === "document" ? { filename: asset.filename } : {}),
      };
      let response;
      try {
        response = await fetchImpl(`${base}/messages`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: asset.messageType, [asset.messageType]: media }),
          signal: AbortSignal.timeout(30_000), redirect: "error",
        });
      } catch {
        throw attachmentError(true);
      }
      if (!response.ok) throw attachmentError(response.status >= 500 || response.status === 408);
      try {
        const providerMessageId = (await response.json())?.messages?.[0]?.id;
        if (typeof providerMessageId !== "string" || !providerMessageId) throw new Error();
        return { providerMessageId };
      } catch {
        throw attachmentError(true);
      }
    },
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
