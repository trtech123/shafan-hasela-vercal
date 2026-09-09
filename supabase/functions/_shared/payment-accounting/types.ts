import type {
  MappedAccountingSource,
  OrderSource,
} from "../rivhit/types.ts";

export interface VerifiedPaymentCheckoutItem {
  id: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
}

export interface VerifiedPelecardPaymentSource {
  id: string;
  provider: "pelecard";
  operation: "payment";
  status: "succeeded";
  orderId: string | null;
  saleId: string;
  providerTransactionId: string;
  amountMinor: number;
  currencyCode: string;
  verifiedAt: string;
  checkoutItems: VerifiedPaymentCheckoutItem[];
  order: OrderSource | null;
  activityName: string | null;
}

export interface MappedPaymentAccountingSource extends MappedAccountingSource {
  sourceType: "payment_transaction";
  documentTypeKey: "payment_success";
  paymentAmountMinor: number;
  currencyCode: string;
}

export type AccountingEventStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "retryable_error"
  | "permanent_error"
  | "reconciliation_required"
  | "configuration_required";

export interface AccountingEventClaim {
  id: string;
  sourceType: string | null;
  sourceId: string | null;
  purpose: string | null;
  accountingProvider: string | null;
  status: AccountingEventStatus | null;
  claimed: boolean;
  attemptCount: number | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  lastError: Record<string, unknown> | null;
}

export interface AccountingEventFence {
  id: string;
  attemptCount: number;
  leaseToken: string;
}

export type AccountingEventFailureStatus =
  | "retryable_error"
  | "permanent_error"
  | "reconciliation_required"
  | "configuration_required";

export interface AccountingEventFailure {
  status: AccountingEventFailureStatus;
  nextAttemptAt: string | null;
  error: Record<string, string | number | boolean | null>;
}
