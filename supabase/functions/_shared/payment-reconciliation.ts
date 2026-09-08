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

export type RejectionCode =
  | "forged_callback"
  | "provider_mismatch"
  | "amount_mismatch"
  | "currency_mismatch";

export type SafeFailureCode = RejectionCode | "provider_declined";

export interface LocalPaymentForReconciliation {
  status: PaymentLifecycleStatus;
  amountMinor: number;
  currencyCode: string;
  terminalNumber: string;
  merchantCorrelation: string;
  providerTransactionId?: string;
  providerSessionReference?: string;
  /** Provider success codes come from confirmed runtime configuration. */
  successfulProviderStatusCodes: readonly string[];
}

export interface CallbackNotice {
  confirmationValid: boolean;
  providerTransactionId?: string;
}

export type ProviderCorrelationEvidence =
  | { kind: "provider_transaction_id"; value: string }
  | { kind: "provider_session"; value: string }
  | { kind: "merchant_correlation"; value: string };

export type ProviderLookupResult =
  | {
    kind: "verified";
    transaction: VerifiedProviderTransaction;
    correlation: ProviderCorrelationEvidence;
  }
  | { kind: "error"; code: "provider_timeout" };

export type ReconciliationDecision =
  | { kind: "finalize"; transaction: VerifiedProviderTransaction }
  | { kind: "already_finalized" }
  | { kind: "reject"; code: RejectionCode }
  | { kind: "mark_failed"; code: "provider_declined" }
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

function hasMatchingCorrelation(
  localPayment: LocalPaymentForReconciliation,
  callbackNotice: CallbackNotice,
  transaction: VerifiedProviderTransaction,
  evidence: ProviderCorrelationEvidence | undefined,
): boolean {
  if (!evidence || typeof evidence.value !== "string") return false;

  switch (evidence.kind) {
    case "provider_transaction_id":
      return evidence.value === transaction.providerTransactionId &&
        (
          evidence.value === localPayment.providerTransactionId ||
          evidence.value === callbackNotice.providerTransactionId
        );
    case "provider_session":
      return localPayment.providerSessionReference !== undefined &&
        evidence.value === localPayment.providerSessionReference;
    case "merchant_correlation":
      return evidence.value === localPayment.merchantCorrelation;
    default:
      return false;
  }
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
    return { kind: "reject", code: "forged_callback" };
  }

  if (providerResult.kind === "error") {
    return { kind: "remain_pending", code: providerResult.code };
  }

  const transaction = providerResult.transaction;

  if (
    transaction.terminalNumber !== localPayment.terminalNumber ||
    transaction.merchantKey !== localPayment.merchantCorrelation
  ) {
    return { kind: "reject", code: "provider_mismatch" };
  }

  if (
    (localPayment.providerTransactionId !== undefined &&
      transaction.providerTransactionId !== localPayment.providerTransactionId) ||
    (callbackNotice.providerTransactionId !== undefined &&
      transaction.providerTransactionId !== callbackNotice.providerTransactionId)
  ) {
    return { kind: "reject", code: "provider_mismatch" };
  }

  if (!hasMatchingCorrelation(
    localPayment,
    callbackNotice,
    transaction,
    providerResult.correlation,
  )) {
    return { kind: "reject", code: "provider_mismatch" };
  }

  if (transaction.amountMinor !== localPayment.amountMinor) {
    return { kind: "reject", code: "amount_mismatch" };
  }

  if (transaction.currencyCode !== localPayment.currencyCode) {
    return { kind: "reject", code: "currency_mismatch" };
  }

  if (!localPayment.successfulProviderStatusCodes.includes(transaction.statusCode)) {
    return { kind: "mark_failed", code: "provider_declined" };
  }

  return { kind: "finalize", transaction: safeTransaction(transaction) };
}
