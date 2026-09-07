import type { VerifiedProviderTransaction } from "./payment-types.ts";

export type PaymentLifecycleStatus =
  | "initiated"
  | "pending_provider"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "refund_pending"
  | "refunded"
  | "void_pending"
  | "voided";

export type SafeFailureCode =
  | "forged_callback"
  | "provider_mismatch"
  | "provider_declined"
  | "amount_mismatch"
  | "currency_mismatch";

export interface LocalPaymentForReconciliation {
  status: PaymentLifecycleStatus;
  amountMinor: number;
  currencyCode: string;
  terminalNumber: string;
  merchantCorrelation: string;
  /** Provider success codes come from confirmed runtime configuration. */
  successfulProviderStatusCodes: readonly string[];
}

export interface CallbackNotice {
  confirmationValid: boolean;
  providerTransactionId?: string;
}

export type ProviderLookupResult =
  | { kind: "verified"; transaction: VerifiedProviderTransaction }
  | { kind: "error"; code: "provider_timeout" };

export type ReconciliationDecision =
  | { kind: "finalize"; transaction: VerifiedProviderTransaction }
  | { kind: "already_finalized" }
  | { kind: "fail"; code: SafeFailureCode }
  | { kind: "remain_pending"; code: "provider_timeout" };

const FINAL_STATES: ReadonlySet<PaymentLifecycleStatus> = new Set([
  "succeeded",
  "failed",
  "refund_pending",
  "refunded",
  "void_pending",
  "voided",
]);

function safeTransaction(
  transaction: VerifiedProviderTransaction,
): VerifiedProviderTransaction {
  return {
    providerTransactionId: transaction.providerTransactionId,
    approvalId: transaction.approvalId,
    statusCode: transaction.statusCode,
    amountMinor: transaction.amountMinor,
    currencyCode: transaction.currencyCode,
    terminalNumber: transaction.terminalNumber,
    merchantKey: transaction.merchantKey,
  };
}

export function reconcilePayment(
  localPayment: LocalPaymentForReconciliation,
  callbackNotice: CallbackNotice,
  providerResult: ProviderLookupResult,
): ReconciliationDecision {
  if (FINAL_STATES.has(localPayment.status)) {
    return { kind: "already_finalized" };
  }

  if (!callbackNotice.confirmationValid) {
    return { kind: "fail", code: "forged_callback" };
  }

  if (providerResult.kind === "error") {
    return { kind: "remain_pending", code: providerResult.code };
  }

  const transaction = providerResult.transaction;

  if (
    transaction.terminalNumber !== localPayment.terminalNumber ||
    transaction.merchantKey !== localPayment.merchantCorrelation
  ) {
    return { kind: "fail", code: "provider_mismatch" };
  }

  if (
    callbackNotice.providerTransactionId !== undefined &&
    transaction.providerTransactionId !== callbackNotice.providerTransactionId
  ) {
    return { kind: "fail", code: "provider_mismatch" };
  }

  if (!localPayment.successfulProviderStatusCodes.includes(transaction.statusCode)) {
    return { kind: "fail", code: "provider_declined" };
  }

  if (transaction.amountMinor !== localPayment.amountMinor) {
    return { kind: "fail", code: "amount_mismatch" };
  }

  if (transaction.currencyCode !== localPayment.currencyCode) {
    return { kind: "fail", code: "currency_mismatch" };
  }

  return { kind: "finalize", transaction: safeTransaction(transaction) };
}
