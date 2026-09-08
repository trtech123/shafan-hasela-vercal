import {
  authorizeStaff,
  type PaymentAuthenticator,
} from "./payment-auth.ts";
import {
  parsePaymentJson,
  paymentCorsHeaders,
  PaymentHttpError,
  paymentJson,
} from "./payment-http.ts";
import type { PaymentStatus } from "./payment-store.ts";
import { PaymentError } from "./payment-types.ts";

type AdjustmentOperation = "refund" | "void";
type AdjustmentStatus = "refund_pending" | "refunded" | "void_pending" | "voided";

interface OriginalPayment {
  id: string;
  status: PaymentStatus;
  providerTransactionId: string | null;
  amountMinor: number;
  currencyCode: string;
}

interface AdjustmentRecord {
  id: string;
  parentPaymentId: string;
  operation: AdjustmentOperation;
  status: AdjustmentStatus;
}

export interface PaymentAdjustmentStore {
  getOriginal(paymentId: string): Promise<OriginalPayment | null>;
  reserve(input: {
    proposedAdjustmentId: string;
    parentPaymentId: string;
    createdBy: string;
    idempotencyKey: string;
    operation: AdjustmentOperation;
    amountMinor: number;
    currencyCode: string;
  }): Promise<{ created: boolean; adjustment: AdjustmentRecord }>;
  complete(
    adjustmentId: string,
    result: PaymentAdjustmentResult,
  ): Promise<AdjustmentRecord>;
}

export interface PaymentAdjustmentResult {
  providerTransactionId: string;
  approvalId: string;
  statusCode: string;
}

export interface PaymentAdjustmentProvider {
  adjust(input: {
    operation: AdjustmentOperation;
    originalProviderTransactionId: string;
    amountMinor: number;
    currencyCode: string;
    merchantCorrelation: string;
  }): Promise<PaymentAdjustmentResult>;
}

export interface PelecardRefundDependencies {
  auth: PaymentAuthenticator;
  store: PaymentAdjustmentStore;
  provider: PaymentAdjustmentProvider;
  createAdjustmentId: () => string;
  config: {
    allowedAppOrigins: readonly string[];
    maxBodyBytes: number;
    enabled: boolean;
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;

function validateInput(value: unknown): {
  paymentId: string;
  operation: AdjustmentOperation;
  idempotencyKey: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentHttpError(400, "invalid_input");
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 3 ||
    typeof body.paymentId !== "string" || !UUID_PATTERN.test(body.paymentId) ||
    (body.operation !== "refund" && body.operation !== "void") ||
    typeof body.idempotencyKey !== "string" ||
    !IDEMPOTENCY_PATTERN.test(body.idempotencyKey)) {
    throw new PaymentHttpError(400, "invalid_input");
  }
  return body as {
    paymentId: string;
    operation: AdjustmentOperation;
    idempotencyKey: string;
  };
}

function safeAdjustment(adjustment: AdjustmentRecord): Record<string, unknown> {
  return {
    paymentId: adjustment.parentPaymentId,
    adjustmentId: adjustment.id,
    operation: adjustment.operation,
    status: adjustment.status,
  };
}

function errorResponse(
  error: unknown,
  cors: HeadersInit,
  adjustmentId?: string,
): Response | null {
  if (!(error instanceof PaymentError)) return null;
  const status = error.code === "capability_disabled" ||
      error.code === "capability_unconfigured"
    ? 503
    : error.code === "provider_timeout"
    ? 504
    : 502;
  return paymentJson({
    error: { code: error.code },
    ...(adjustmentId ? { adjustmentId } : {}),
  }, status, cors);
}

export function createPelecardRefundHandler(
  dependencies: PelecardRefundDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let cors: HeadersInit = {};
    try {
      cors = paymentCorsHeaders(request, dependencies.config.allowedAppOrigins);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }
      if (request.method !== "POST") {
        return paymentJson({ error: { code: "method_not_allowed" } }, 405, cors);
      }
      if (!dependencies.config.enabled) {
        throw new PaymentError("capability_disabled");
      }

      const authorization = await authorizeStaff(request, dependencies.auth);
      if (authorization.ok === false) {
        return paymentJson(
          { error: { code: authorization.code } },
          authorization.status,
          cors,
        );
      }
      if (authorization.identity.role !== "admin") {
        return paymentJson({ error: { code: "forbidden" } }, 403, cors);
      }

      const input = validateInput(await parsePaymentJson(
        request,
        dependencies.config.maxBodyBytes,
      ));
      const original = await dependencies.store.getOriginal(input.paymentId);
      if (!original) {
        return paymentJson({ error: { code: "not_found" } }, 404, cors);
      }
      if (original.status !== "succeeded" || !original.providerTransactionId) {
        return paymentJson({ error: { code: "invalid_state" } }, 409, cors);
      }

      const reservation = await dependencies.store.reserve({
        proposedAdjustmentId: dependencies.createAdjustmentId(),
        parentPaymentId: original.id,
        createdBy: authorization.identity.id,
        idempotencyKey: input.idempotencyKey,
        operation: input.operation,
        amountMinor: original.amountMinor,
        currencyCode: original.currencyCode,
      });
      if (reservation.adjustment.parentPaymentId !== original.id ||
        reservation.adjustment.operation !== input.operation) {
        return paymentJson({ error: { code: "idempotency_conflict" } }, 409, cors);
      }
      if (!reservation.created) {
        const completed = reservation.adjustment.status === "refunded" ||
          reservation.adjustment.status === "voided";
        return paymentJson(
          safeAdjustment(reservation.adjustment),
          completed ? 200 : 202,
          cors,
        );
      }

      try {
        const providerResult = await dependencies.provider.adjust({
          operation: input.operation,
          originalProviderTransactionId: original.providerTransactionId,
          amountMinor: original.amountMinor,
          currencyCode: original.currencyCode,
          merchantCorrelation: reservation.adjustment.id,
        });
        const adjustment = await dependencies.store.complete(
          reservation.adjustment.id,
          providerResult,
        );
        return paymentJson(safeAdjustment(adjustment), 200, cors);
      } catch (error) {
        return errorResponse(error, cors, reservation.adjustment.id) ??
          paymentJson({
            error: { code: "provider_unavailable" },
            adjustmentId: reservation.adjustment.id,
          }, 502, cors);
      }
    } catch (error) {
      if (error instanceof PaymentHttpError) {
        return paymentJson({ error: { code: error.code } }, error.status, cors);
      }
      return errorResponse(error, cors) ??
        paymentJson({ error: { code: "internal_error" } }, 500, cors);
    }
  };
}
