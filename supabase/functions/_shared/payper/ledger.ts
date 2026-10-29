import { classifyDispatchedPayperOutcome, type PayperDispatchOutcome, type PayperDispatchResult } from "./outcome.ts";

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data?: unknown; error?: unknown }>;
}

function result(value: { data?: unknown; error?: unknown }, operation: string): unknown {
  // Never include provider, database, or credential-bearing error text.
  if (value.error) throw new Error(`payper_${operation}_failed`);
  return value.data;
}

export function createPayperLedger(client: RpcClient, dispatchEnabled = false) {
  return {
    async freezeSource(paymentId: string): Promise<unknown> {
      if (!paymentId) throw new Error("payper_payment_id_required");
      return result(await client.rpc("freeze_payper_source", { p_payment_id: paymentId }), "freeze_source");
    },
    async reserveDispatch(paymentId: string): Promise<string> {
      if (!dispatchEnabled) throw new Error("payper_dispatch_disabled");
      if (!paymentId) throw new Error("payper_payment_id_required");
      const response = await client.rpc("reserve_payper_dispatch", { p_payment_id: paymentId });
      if (response.error && typeof response.error === "object" && "message" in response.error
        && response.error.message === "payper_dispatch_limit_reached")
        throw new Error("payper_dispatch_limit_reached");
      const reservation = result(response, "reserve_dispatch");
      if (typeof reservation !== "string" || !reservation) throw new Error("payper_reservation_invalid");
      return reservation;
    },
    async holdFailure(paymentId: string): Promise<void> {
      if (!paymentId) throw new Error("payper_payment_id_required");
      result(await client.rpc("hold_payper_source", { p_payment_id: paymentId }), "hold_source");
    },
    async recordOutcome(paymentId: string, outcome: PayperDispatchOutcome): Promise<void> {
      if (!paymentId) throw new Error("payper_payment_id_required");
      const args = outcome.state === "succeeded"
        ? {
          p_payment_id: paymentId, p_state: "succeeded",
          p_document_number: outcome.documentNumber, p_document_url: outcome.documentUrl,
          p_code: null,
        }
        : {
          p_payment_id: paymentId, p_state: "reconciliation_required",
          p_document_number: null, p_document_url: null,
          p_code: outcome.safeCode ?? "uncertain_provider_outcome",
        };
      result(await client.rpc("record_payper_dispatch_outcome", args), "record_outcome");
    },
    async recordDispatchedOutcome(paymentId: string, response: PayperDispatchResult): Promise<void> {
      await this.recordOutcome(paymentId, classifyDispatchedPayperOutcome(response));
    },
  };
}

export const createDisabledPayperLedger = (client: RpcClient) => createPayperLedger(client);
