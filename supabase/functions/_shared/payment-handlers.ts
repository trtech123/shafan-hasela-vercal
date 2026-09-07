import {
  authorizeStaff,
  type PaymentAuthenticator,
} from "./payment-auth.ts";
import {
  parsePaymentBody,
  parsePaymentJson,
  paymentCorsHeaders,
  PaymentHttpError,
  paymentJson,
} from "./payment-http.ts";
import {
  reconcilePayment,
  type PaymentLifecycleStatus,
  type ProviderCorrelationEvidence,
} from "./payment-reconciliation.ts";
import {
  type ConfirmationValidation,
  type LookupProviderPayment,
  PaymentError,
  type VerifiedProviderTransaction,
} from "./payment-types.ts";

type UnknownRecord = Record<string, unknown>;

export interface PaymentNotification {
  paymentId: string;
  confirmationKey: string;
  uniqueKey: string;
  providerTransactionId?: string;
  callbackReference?: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string | null;
  saleId: string | null;
  amountMinor: number;
  currencyCode: string;
  status: PaymentLifecycleStatus;
  failureCode: string | null;
  providerTransactionId: string | null;
  providerSessionReference: string | null;
  receiptNumber: string | null;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
}

export interface PaymentVerificationStore {
  getPayment(paymentId: string): Promise<PaymentRecord | null>;
  finalize(
    paymentId: string,
    transaction: VerifiedProviderTransaction,
  ): Promise<PaymentRecord>;
  markFailed(
    paymentId: string,
    providerStatusCode: string,
  ): Promise<PaymentRecord>;
}

export interface PaymentVerificationProvider {
  validateConfirmation(input: ConfirmationValidation): Promise<boolean>;
  lookup(input: LookupProviderPayment): Promise<{
    transaction: VerifiedProviderTransaction;
    correlationEvidence: ProviderCorrelationEvidence;
  }>;
}

export type PaymentNotificationDecoder = (input: {
  contentType: string;
  body: unknown;
}) => PaymentNotification;

export interface PaymentHandlerConfig {
  allowedAppOrigins: readonly string[];
  maxBodyBytes: number;
  terminalReference: string;
  successfulProviderStatusCodes: readonly string[];
}

interface VerificationDependencies {
  store: PaymentVerificationStore;
  provider: PaymentVerificationProvider;
  decodeNotification: PaymentNotificationDecoder;
  config: PaymentHandlerConfig;
}

interface AuthenticatedVerificationDependencies extends VerificationDependencies {
  auth: PaymentAuthenticator;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINAL_STATUSES: ReadonlySet<PaymentLifecycleStatus> = new Set([
  "succeeded",
  "failed",
  "refund_pending",
  "refunded",
  "void_pending",
  "voided",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIdentifier(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim() === value &&
    value.length > 0 && value.length <= maximum;
}

function validateNotification(value: unknown): PaymentNotification {
  if (!isRecord(value) || !UUID_PATTERN.test(String(value.paymentId)) ||
    !validIdentifier(value.confirmationKey, 1_000) ||
    !validIdentifier(value.uniqueKey, 500) ||
    (value.providerTransactionId !== undefined &&
      !validIdentifier(value.providerTransactionId, 100)) ||
    (value.callbackReference !== undefined &&
      !validIdentifier(value.callbackReference, 500))) {
    throw new PaymentHttpError(400, "invalid_input");
  }
  return {
    paymentId: value.paymentId as string,
    confirmationKey: value.confirmationKey,
    uniqueKey: value.uniqueKey,
    providerTransactionId: value.providerTransactionId as string | undefined,
    callbackReference: value.callbackReference as string | undefined,
  };
}

function safePaymentResult(payment: PaymentRecord): Record<string, unknown> {
  return {
    paymentId: payment.id,
    saleId: payment.saleId,
    status: payment.status,
  };
}

function pendingResult(payment: PaymentRecord): Record<string, unknown> {
  return { paymentId: payment.id, status: payment.status };
}

function paymentErrorResponse(
  error: unknown,
  payment: PaymentRecord | null,
  cors: HeadersInit,
): Response | null {
  if (!(error instanceof PaymentError)) return null;
  if (error.code === "forged_callback" || error.code === "invalid_input") {
    return paymentJson({ error: { code: error.code } }, 400, cors);
  }
  if (error.code === "provider_mismatch") {
    return paymentJson({ error: { code: error.code } }, 409, cors);
  }
  if (error.code === "provider_timeout" || error.code === "provider_unavailable") {
    return paymentJson(
      payment ? pendingResult(payment) : { error: { code: error.code } },
      202,
      cors,
    );
  }
  if (error.code === "capability_unconfigured" ||
    error.code === "capability_disabled") {
    return paymentJson({ error: { code: error.code } }, 503, cors);
  }
  return paymentJson({ error: { code: "invalid_provider_response" } }, 502, cors);
}

async function verifyPayment(
  notice: PaymentNotification,
  dependencies: VerificationDependencies,
  cors: HeadersInit,
): Promise<Response> {
  const payment = await dependencies.store.getPayment(notice.paymentId);
  if (!payment) {
    return paymentJson({ error: { code: "not_found" } }, 404, cors);
  }
  if (FINAL_STATUSES.has(payment.status)) {
    return paymentJson(safePaymentResult(payment), 200, cors);
  }

  try {
    const confirmationValid = await dependencies.provider.validateConfirmation({
      confirmationKey: notice.confirmationKey,
      uniqueKey: notice.uniqueKey,
      amountMinor: payment.amountMinor,
    });
    if (confirmationValid !== true) {
      throw new PaymentError("forged_callback");
    }

    const lookup = await dependencies.provider.lookup({
      localPaymentId: payment.id,
      merchantCorrelation: payment.id,
      terminalReference: dependencies.config.terminalReference,
      providerTransactionId: notice.providerTransactionId ??
        payment.providerTransactionId ?? undefined,
      sessionReference: payment.providerSessionReference ?? undefined,
      callbackReference: notice.callbackReference,
    });
    const decision = reconcilePayment({
      status: payment.status,
      amountMinor: payment.amountMinor,
      currencyCode: payment.currencyCode,
      terminalNumber: dependencies.config.terminalReference,
      merchantCorrelation: payment.id,
      providerTransactionId: payment.providerTransactionId ?? undefined,
      providerSessionReference: payment.providerSessionReference ?? undefined,
      successfulProviderStatusCodes:
        dependencies.config.successfulProviderStatusCodes,
    }, {
      confirmationValid: true,
      providerTransactionId: notice.providerTransactionId,
    }, {
      kind: "verified",
      transaction: lookup.transaction,
      correlation: lookup.correlationEvidence,
    });

    if (decision.kind === "finalize") {
      const finalized = await dependencies.store.finalize(
        payment.id,
        decision.transaction,
      );
      return paymentJson(safePaymentResult(finalized), 200, cors);
    }
    if (decision.kind === "mark_failed") {
      const failed = await dependencies.store.markFailed(
        payment.id,
        lookup.transaction.statusCode,
      );
      return paymentJson(safePaymentResult(failed), 200, cors);
    }
    if (decision.kind === "already_finalized") {
      return paymentJson(safePaymentResult(payment), 200, cors);
    }
    if (decision.kind === "remain_pending") {
      return paymentJson(pendingResult(payment), 202, cors);
    }
    const status = decision.code === "forged_callback" ? 400 : 409;
    return paymentJson({ error: { code: decision.code } }, status, cors);
  } catch (error) {
    const response = paymentErrorResponse(error, payment, cors);
    if (response) return response;
    return paymentJson({ error: { code: "internal_error" } }, 500, cors);
  }
}

function methodResponse(request: Request, cors: HeadersInit): Response | null {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return paymentJson({ error: { code: "method_not_allowed" } }, 405, cors);
  }
  return null;
}

export function createPelecardCallbackHandler(
  dependencies: VerificationDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let cors: HeadersInit = {};
    try {
      cors = paymentCorsHeaders(request, dependencies.config.allowedAppOrigins);
      const early = methodResponse(request, cors);
      if (early) return early;
      const parsed = await parsePaymentBody(
        request,
        dependencies.config.maxBodyBytes,
      );
      const notice = validateNotification(
        dependencies.decodeNotification(parsed),
      );
      return await verifyPayment(notice, dependencies, cors);
    } catch (error) {
      if (error instanceof PaymentHttpError) {
        return paymentJson({ error: { code: error.code } }, error.status, cors);
      }
      const providerResponse = paymentErrorResponse(error, null, cors);
      return providerResponse ?? paymentJson(
        { error: { code: "internal_error" } },
        500,
        cors,
      );
    }
  };
}

export function createPelecardVerifyHandler(
  dependencies: AuthenticatedVerificationDependencies,
): (request: Request) => Promise<Response> {
  const callback = createPelecardCallbackHandler(dependencies);
  return async (request) => {
    let cors: HeadersInit = {};
    try {
      cors = paymentCorsHeaders(request, dependencies.config.allowedAppOrigins);
      const early = methodResponse(request, cors);
      if (early) return early;
      const authorization = await authorizeStaff(request, dependencies.auth);
      if (authorization.ok === false) {
        return paymentJson(
          { error: { code: authorization.code } },
          authorization.status,
          cors,
        );
      }
      return await callback(request);
    } catch (error) {
      if (error instanceof PaymentHttpError) {
        return paymentJson({ error: { code: error.code } }, error.status, cors);
      }
      return paymentJson({ error: { code: "internal_error" } }, 500, cors);
    }
  };
}

function paymentIdBody(value: unknown): string {
  if (!isRecord(value) || Object.keys(value).length !== 1 ||
    typeof value.paymentId !== "string" || !UUID_PATTERN.test(value.paymentId)) {
    throw new PaymentHttpError(400, "invalid_input");
  }
  return value.paymentId;
}

function amountString(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new PaymentHttpError(500, "invalid_storage_response");
  }
  return `${Math.trunc(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

function statusProjection(payment: PaymentRecord): Record<string, unknown> {
  return {
    id: payment.id,
    orderId: payment.orderId,
    saleId: payment.saleId,
    amount: amountString(payment.amountMinor),
    currency: payment.currencyCode,
    status: payment.status,
    failureCode: payment.failureCode,
    receiptNumber: payment.receiptNumber,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    verifiedAt: payment.verifiedAt,
  };
}

export function createPelecardStatusHandler(dependencies: {
  auth: PaymentAuthenticator;
  store: Pick<PaymentVerificationStore, "getPayment">;
  config: Pick<PaymentHandlerConfig, "allowedAppOrigins" | "maxBodyBytes">;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    let cors: HeadersInit = {};
    try {
      cors = paymentCorsHeaders(request, dependencies.config.allowedAppOrigins);
      const early = methodResponse(request, cors);
      if (early) return early;
      const authorization = await authorizeStaff(request, dependencies.auth);
      if (authorization.ok === false) {
        return paymentJson(
          { error: { code: authorization.code } },
          authorization.status,
          cors,
        );
      }
      const paymentId = paymentIdBody(await parsePaymentJson(
        request,
        dependencies.config.maxBodyBytes,
      ));
      const payment = await dependencies.store.getPayment(paymentId);
      if (!payment) {
        return paymentJson({ error: { code: "not_found" } }, 404, cors);
      }
      return paymentJson(statusProjection(payment), 200, cors);
    } catch (error) {
      if (error instanceof PaymentHttpError) {
        return paymentJson({ error: { code: error.code } }, error.status, cors);
      }
      return paymentJson({ error: { code: "internal_error" } }, 500, cors);
    }
  };
}
