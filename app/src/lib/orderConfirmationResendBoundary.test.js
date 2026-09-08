import { describe, expect, test, vi } from "vitest";
import {
  ORDER_CONFIRMATION_RESEND_ENABLED,
  resendOrderConfirmation,
} from "../../../supabase/functions/_shared/chatbot/actions/resend-order-confirmation.js";

const command = {
  orderId: "opaque-order-id",
  verifiedContactId: "verified-contact-id",
  conversationId: "conversation-id",
  triggerEventId: "event-id",
  idempotencyKey: "event-id:resend_order_confirmation",
};

describe("order confirmation resend security boundary", () => {
  test("is explicitly unavailable until canonical artifacts are persisted", async () => {
    const recordAction = vi.fn().mockResolvedValue(undefined);

    const result = await resendOrderConfirmation(command, { recordAction });

    expect(ORDER_CONFIRMATION_RESEND_ENABLED).toBe(false);
    expect(result).toEqual({
      status: "handoff_required",
      reason: "artifact_persistence_unavailable",
    });
    expect(recordAction).toHaveBeenCalledWith({
      ...command,
      actionId: "resend_order_confirmation",
      availability: "handoff_only",
      outcome: "handoff_required",
      failureCode: "artifact_persistence_unavailable",
    });
    expect(result).not.toHaveProperty("orderId");
    expect(result).not.toHaveProperty("total");
    expect(result).not.toHaveProperty("destination");
    expect(result).not.toHaveProperty("pdf");
  });

  test.each(["orderId", "verifiedContactId", "conversationId", "triggerEventId", "idempotencyKey"])(
    "rejects a command missing server-side %s",
    async (field) => {
      await expect(resendOrderConfirmation({ ...command, [field]: "" }, { recordAction: vi.fn() }))
        .rejects.toThrow(`Missing secure resend field: ${field}`);
    },
  );

  test("fails closed when the audit cannot be recorded", async () => {
    await expect(resendOrderConfirmation(command, {
      recordAction: vi.fn().mockRejectedValue(new Error("audit unavailable")),
    })).rejects.toThrow("audit unavailable");
  });
});
