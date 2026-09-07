import {
  type ConfirmationValidation,
  type HostedPaymentSession,
  type InitiateProviderPayment,
  type LookupProviderPayment,
  type PaymentProvider,
  type ProviderAdjustment,
  type ProviderAdjustmentCapabilityInput,
  type VerifiedProviderTransaction,
  PaymentError,
} from "./payment-types.ts";

type UnknownRecord = Record<string, unknown>;
type ProviderTransport<Input> = (
  input: Input,
  signal: AbortSignal,
) => Promise<unknown>;
type ProviderDecoder<Output> = (response: unknown) => Output;

export interface PelecardCapabilities {
  initiate?: {
    transport: ProviderTransport<InitiateProviderPayment>;
    decode: ProviderDecoder<unknown>;
  };
  validateConfirmation?: (
    input: ConfirmationValidation,
    signal: AbortSignal,
  ) => Promise<boolean>;
  lookup?: {
    transport: ProviderTransport<LookupProviderPayment>;
    decode: ProviderDecoder<unknown>;
  };
  /**
   * No provider cancellation/refund wire contract is assumed here. This
   * capability may be supplied only after that contract is confirmed.
   */
  cancel?: (
    input: ProviderAdjustmentCapabilityInput,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

export interface PelecardConfig {
  allowedRedirectOrigins: readonly string[];
  capabilities?: PelecardCapabilities;
  timeoutMs?: number;
  cancelEnabled?: boolean;
  refundEnabled?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function timeoutSignal(config: PelecardConfig): AbortSignal {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new PaymentError("invalid_configuration");
  }
  return AbortSignal.timeout(timeoutMs);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError");
}

async function callTransport<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    if (isTimeoutError(error)) throw new PaymentError("provider_timeout");
    throw new PaymentError("provider_unavailable");
  }
}

function decodeResponse(
  decoder: ProviderDecoder<unknown>,
  response: unknown,
): unknown {
  try {
    return decoder(response);
  } catch {
    throw new PaymentError("invalid_provider_response");
  }
}

function asRecord(value: unknown): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PaymentError("invalid_provider_response");
  }
  return value as UnknownRecord;
}

function requiredString(
  record: UnknownRecord,
  field: string,
  maxLength = 500,
): string {
  const value = record[field];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.length > maxLength
  ) {
    throw new PaymentError("invalid_provider_response");
  }
  return value;
}

function assertInputString(value: unknown, maxLength = 500): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.length > maxLength
  ) {
    throw new PaymentError("invalid_input");
  }
}

function assertAmountMinor(value: unknown, errorCode: "invalid_input" | "invalid_provider_response"): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new PaymentError(errorCode);
  }
}

function assertCurrencyCode(value: unknown, errorCode: "invalid_input" | "invalid_provider_response"): asserts value is string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    throw new PaymentError(errorCode);
  }
}

function assertHttpsUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PaymentError("invalid_input");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new PaymentError("invalid_input");
  }
}

function validateInitiationInput(input: InitiateProviderPayment): void {
  assertAmountMinor(input.amountMinor, "invalid_input");
  assertCurrencyCode(input.currencyCode, "invalid_input");
  assertInputString(input.merchantKey);
  assertInputString(input.returnUrl, 2_048);
  assertInputString(input.callbackUrl, 2_048);
  assertHttpsUrl(input.returnUrl);
  assertHttpsUrl(input.callbackUrl);
}

function sanitizeHostedSession(
  decoded: unknown,
  allowedRedirectOrigins: ReadonlySet<string>,
): HostedPaymentSession {
  const record = asRecord(decoded);
  const redirectUrl = requiredString(record, "redirectUrl", 2_048);
  const sessionReference = requiredString(record, "sessionReference");

  let parsed: URL;
  try {
    parsed = new URL(redirectUrl);
  } catch {
    throw new PaymentError("invalid_provider_response");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !allowedRedirectOrigins.has(parsed.origin)
  ) {
    throw new PaymentError("invalid_provider_response");
  }

  return { redirectUrl, sessionReference };
}

function normalizeAllowedRedirectOrigins(
  configuredOrigins: readonly string[],
): ReadonlySet<string> {
  if (!Array.isArray(configuredOrigins) || configuredOrigins.length === 0) {
    throw new PaymentError("invalid_configuration");
  }

  const origins = new Set<string>();
  for (const configuredOrigin of configuredOrigins) {
    if (
      typeof configuredOrigin !== "string" ||
      configuredOrigin.length === 0 ||
      configuredOrigin.trim() !== configuredOrigin
    ) {
      throw new PaymentError("invalid_configuration");
    }

    let parsed: URL;
    try {
      parsed = new URL(configuredOrigin);
    } catch {
      throw new PaymentError("invalid_configuration");
    }

    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new PaymentError("invalid_configuration");
    }
    origins.add(parsed.origin);
  }
  return origins;
}

function sanitizeVerifiedTransaction(decoded: unknown): VerifiedProviderTransaction {
  const record = asRecord(decoded);
  const amountMinor = record.amountMinor;
  const currencyCode = record.currencyCode;
  assertAmountMinor(amountMinor, "invalid_provider_response");
  assertCurrencyCode(currencyCode, "invalid_provider_response");

  return {
    providerTransactionId: requiredString(record, "providerTransactionId", 100),
    approvalId: requiredString(record, "approvalId", 100),
    statusCode: requiredString(record, "statusCode", 100),
    amountMinor,
    currencyCode,
    terminalNumber: requiredString(record, "terminalNumber", 100),
    merchantKey: requiredString(record, "merchantKey", 500),
  };
}

function validateConfirmationInput(input: ConfirmationValidation): void {
  assertInputString(input.confirmationKey, 1_000);
  assertInputString(input.uniqueKey, 500);
  assertAmountMinor(input.amountMinor, "invalid_input");
}

function validateLookupInput(input: LookupProviderPayment): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PaymentError("invalid_input");
  }
  assertInputString(input.localPaymentId, 100);
  assertInputString(input.merchantCorrelation, 500);

  for (const optionalCorrelation of [
    input.terminalReference,
    input.providerTransactionId,
    input.sessionReference,
    input.callbackReference,
  ]) {
    if (optionalCorrelation !== undefined) {
      assertInputString(optionalCorrelation, 500);
    }
  }
}

function validateAdjustment(input: ProviderAdjustment): void {
  assertInputString(input.providerTransactionId, 100);
  if (input.amountMinor !== undefined) {
    assertAmountMinor(input.amountMinor, "invalid_input");
  }
}

export function createPelecardClient(config: PelecardConfig): PaymentProvider {
  const capabilities = config.capabilities ?? {};
  const allowedRedirectOrigins = normalizeAllowedRedirectOrigins(
    config.allowedRedirectOrigins,
  );

  return {
    async initiate(input) {
      const capability = capabilities.initiate;
      if (!capability) throw new PaymentError("capability_unconfigured");
      validateInitiationInput(input);
      const response = await callTransport(() =>
        capability.transport(input, timeoutSignal(config))
      );
      const decoded = decodeResponse(capability.decode, response);
      return sanitizeHostedSession(decoded, allowedRedirectOrigins);
    },

    async validateConfirmation(input) {
      const capability = capabilities.validateConfirmation;
      if (!capability) throw new PaymentError("capability_unconfigured");
      validateConfirmationInput(input);
      const valid = await callTransport(() =>
        capability(input, timeoutSignal(config))
      );
      if (valid !== true) throw new PaymentError("forged_callback");
      return true;
    },

    async lookup(input) {
      const capability = capabilities.lookup;
      if (!capability) throw new PaymentError("capability_unconfigured");
      validateLookupInput(input);
      const response = await callTransport(() =>
        capability.transport(input, timeoutSignal(config))
      );
      const decoded = decodeResponse(capability.decode, response);
      const transaction = sanitizeVerifiedTransaction(decoded);
      if (
        input.providerTransactionId !== undefined &&
        transaction.providerTransactionId !== input.providerTransactionId
      ) {
        throw new PaymentError("provider_mismatch");
      }
      return transaction;
    },

    async cancel(input) {
      if (config.cancelEnabled !== true) {
        throw new PaymentError("capability_disabled");
      }
      const capability = capabilities.cancel;
      if (!capability) throw new PaymentError("capability_unconfigured");
      validateAdjustment(input);
      await callTransport(() => capability(
        { ...input, operation: "cancel" },
        timeoutSignal(config),
      ));
    },

    async refund(input) {
      if (config.refundEnabled !== true) {
        throw new PaymentError("capability_disabled");
      }
      const capability = capabilities.cancel;
      if (!capability) throw new PaymentError("capability_unconfigured");
      validateAdjustment(input);
      await callTransport(() => capability(
        { ...input, operation: "refund" },
        timeoutSignal(config),
      ));
    },
  };
}
