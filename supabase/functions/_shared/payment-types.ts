export type PaymentErrorCode =
  | "capability_disabled"
  | "capability_unconfigured"
  | "forged_callback"
  | "invalid_configuration"
  | "invalid_input"
  | "invalid_provider_response"
  | "provider_mismatch"
  | "provider_timeout"
  | "provider_unavailable";

/** A deliberately detail-free error that is safe to serialize at an API boundary. */
export class PaymentError extends Error {
  readonly code: PaymentErrorCode;

  constructor(code: PaymentErrorCode) {
    super(code);
    this.name = "PaymentError";
    this.code = code;
  }
}

export interface InitiateProviderPayment {
  amountMinor: number;
  currencyCode: string;
  merchantKey: string;
  returnUrl: string;
  callbackUrl: string;
}

export interface HostedPaymentSession {
  redirectUrl: string;
  sessionReference: string;
}

export interface ConfirmationValidation {
  confirmationKey: string;
  uniqueKey: string;
  amountMinor: number;
}

export interface VerifiedProviderTransaction {
  providerTransactionId: string;
  approvalId: string;
  statusCode: string;
  amountMinor: number;
  currencyCode: string;
  terminalNumber: string;
  merchantKey: string;
}

export interface ProviderAdjustment {
  providerTransactionId: string;
  amountMinor?: number;
}

export interface ProviderAdjustmentCapabilityInput extends ProviderAdjustment {
  operation: "cancel" | "refund";
}

export interface PaymentProvider {
  initiate(input: InitiateProviderPayment): Promise<HostedPaymentSession>;
  validateConfirmation(input: ConfirmationValidation): Promise<true>;
  lookup(providerTransactionId: string): Promise<VerifiedProviderTransaction>;
  cancel(input: ProviderAdjustment): Promise<void>;
  refund(input: ProviderAdjustment): Promise<void>;
}
