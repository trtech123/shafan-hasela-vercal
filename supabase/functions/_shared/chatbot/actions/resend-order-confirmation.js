export const ORDER_CONFIRMATION_RESEND_ENABLED = false;

const requiredFields = [
  "orderId",
  "verifiedContactId",
  "conversationId",
  "triggerEventId",
  "idempotencyKey",
];

export async function resendOrderConfirmation(command, { recordAction }) {
  for (const field of requiredFields) {
    if (!command?.[field]) throw new Error(`Missing secure resend field: ${field}`);
  }
  if (typeof recordAction !== "function") throw new Error("Missing secure resend audit writer");

  await recordAction({
    ...command,
    actionId: "resend_order_confirmation",
    availability: "handoff_only",
    outcome: "handoff_required",
    failureCode: "artifact_persistence_unavailable",
  });

  return {
    status: "handoff_required",
    reason: "artifact_persistence_unavailable",
  };
}
