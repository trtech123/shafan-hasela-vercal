import { authorizeStaff, type PaymentAuthenticator } from "../payment-auth.ts";
import {
  parsePaymentJson,
  paymentCorsHeaders,
  PaymentHttpError,
  paymentJson,
} from "../payment-http.ts";
import type { PaymentAccountingEventResult } from "./processor.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface WorkerDependencies {
  auth: PaymentAuthenticator;
  processEvent: (
    eventId: string,
    forceRetry: boolean,
  ) => Promise<PaymentAccountingEventResult>;
  allowedAppOrigins: readonly string[];
  maxBodyBytes: number;
}

function workerInput(value: unknown): { eventId: string; forceRetry: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentHttpError(400, "invalid_input");
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  const allowed = row.forceRetry === undefined
    ? ["eventId"]
    : ["eventId", "forceRetry"];
  if (
    keys.length !== allowed.length
    || !keys.every((key, index) => key === allowed[index])
    || typeof row.eventId !== "string"
    || !UUID_PATTERN.test(row.eventId)
    || (row.forceRetry !== undefined && typeof row.forceRetry !== "boolean")
  ) {
    throw new PaymentHttpError(400, "invalid_input");
  }
  return { eventId: row.eventId, forceRetry: row.forceRetry === true };
}

function responseStatus(result: PaymentAccountingEventResult): number {
  if (result.status === "succeeded") return 200;
  if (
    result.status === "permanent_error"
    || result.status === "reconciliation_required"
  ) return 409;
  if (result.status === null) return 404;
  return 202;
}

export function createPaymentAccountingWorkerHandler(
  dependencies: WorkerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let cors: HeadersInit = {};
    try {
      cors = paymentCorsHeaders(request, dependencies.allowedAppOrigins);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method !== "POST") {
        return paymentJson({ error: { code: "method_not_allowed" } }, 405, cors);
      }
      const authorization = await authorizeStaff(request, dependencies.auth);
      if (authorization.ok === false) {
        return paymentJson(
          { error: { code: authorization.code } },
          authorization.status,
          cors,
        );
      }
      if (authorization.identity.role === "cashier") {
        return paymentJson({ error: { code: "forbidden" } }, 403, cors);
      }
      const input = workerInput(await parsePaymentJson(request, dependencies.maxBodyBytes));
      const result = await dependencies.processEvent(input.eventId, input.forceRetry);
      if (result.status === null) {
        return paymentJson(
          { ok: false, error: { code: "not_found" } },
          404,
          cors,
        );
      }
      return paymentJson({ ok: true, ...result }, responseStatus(result), cors);
    } catch (error) {
      if (error instanceof PaymentHttpError) {
        return paymentJson({ error: { code: error.code } }, error.status, cors);
      }
      return paymentJson({ error: { code: "internal_error" } }, 500, cors);
    }
  };
}
