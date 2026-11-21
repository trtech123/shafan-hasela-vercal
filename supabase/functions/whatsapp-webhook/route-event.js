// Route only signed webhook events for explicitly configured phone-number IDs.
// The old ID is accepted temporarily during a controlled number cutover.
export async function routeInboundWhatsAppEvent({ event, sender, processEvent }) {
  const sourcePhoneNumberId = event?.sanitizedMetadata?.phoneNumberId;
  if (!sender.acceptsInboundPhoneNumberId(sourcePhoneNumberId)) {
    return { status: "ignored_unknown_phone" };
  }
  return processEvent(event, {
    sendText: (message) => sender.sendText({ ...message, sourcePhoneNumberId }),
  });
}
