import { authorizeStaff, type PaymentAuthenticator } from "./payment-auth.ts";
import { assertPelecardTestMode, type ReadEnvironment } from "./pelecard-test-config.ts";
import { parsePaymentBody, parsePaymentJson, paymentCorsHeaders, PaymentHttpError, paymentJson } from "./payment-http.ts";
import { PaymentError } from "./payment-types.ts";
import type { createPelecardTestProvider, TestVerifiedResult } from "./pelecard-test-provider.ts";
import { readProviderTransactionId } from "./pelecard-test-provider.ts";

export interface TestPaymentRow {
  id: string;
  status: string;
  amount_minor: number;
  confirmation_key: string | null;
  redirect_url: string | null;
  provider_transaction_id: string | null;
}

export interface TestPaymentStore {
  get(id: string): Promise<TestPaymentRow | null>;
  reserve(id: string, actorId: string): Promise<boolean>;
  initiated(id: string, session: { redirectUrl: string; confirmationKey: string }): Promise<void>;
  verified(id: string, result: TestVerifiedResult): Promise<void>;
}

interface Dependencies {
  read: ReadEnvironment;
  auth: PaymentAuthenticator;
  store: TestPaymentStore;
  provider: () => ReturnType<typeof createPelecardTestProvider>;
  allowedOrigins: readonly string[];
  feedbackUrl: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function identifier(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new PaymentHttpError(400, "invalid_input");
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PaymentHttpError(400, "invalid_input");
  return value as Record<string, unknown>;
}
function onlyFields(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some((key) => !keys.includes(key))) throw new PaymentHttpError(400, "invalid_input");
}
function result(id: string, status: string) {
  return { mode: "test", testPaymentId: id, status, commercialEffect: false };
}
function failure(error: unknown, cors: HeadersInit = {}) {
  if (error instanceof PaymentHttpError) return paymentJson({ error: { code: error.code } }, error.status, cors);
  if (error instanceof PaymentError) {
    const status = error.code === "capability_disabled" ? 503 : ["forged_callback", "invalid_input"].includes(error.code) ? 400 : 502;
    return paymentJson({ error: { code: error.code } }, status, cors);
  }
  return paymentJson({ error: { code: "test_operation_failed" } }, 502, cors);
}

async function verify(deps: Dependencies, row: TestPaymentRow, transactionId: string) {
  if (row.status === "test_verified") {
    if (row.provider_transaction_id !== transactionId) throw new PaymentError("provider_mismatch");
    return result(row.id, row.status);
  }
  if (row.status !== "pending" || !row.confirmation_key) throw new PaymentHttpError(409, "test_not_ready");
  const verified = await deps.provider().verify({
    id: row.id, amountMinor: row.amount_minor,
    confirmationKey: row.confirmation_key, transactionId,
  });
  await deps.store.verified(row.id, verified);
  return result(row.id, verified.status);
}

export function createPelecardTestHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    let cors: HeadersInit = {};
    try {
      cors = paymentCorsHeaders(request, deps.allowedOrigins);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method !== "POST") throw new PaymentHttpError(405, "method_not_allowed");
      assertPelecardTestMode(deps.read);
      const auth = await authorizeStaff(request, deps.auth);
      if (!auth.ok) throw new PaymentHttpError(auth.status, auth.code);
      if (auth.identity.role !== "admin") throw new PaymentHttpError(403, "forbidden");
      const body = record(await parsePaymentJson(request, 4096));
      if (body.action === "preflight") {
        onlyFields(body, ["action"]);
        const preflight = await deps.provider().preflight();
        return paymentJson({ mode: "test", ...preflight, transactionCreated: false }, 200, cors);
      }
      onlyFields(body, body.action === "verify" ? ["action", "testPaymentId", "transactionId"] : ["action", "testPaymentId"]);
      const id = identifier(body.testPaymentId);
      if (body.action === "initiate") {
        if (deps.read("PELECARD_TEST_TRANSACTION_ENABLED") !== "true") throw new PaymentError("capability_disabled");
        // Reserve before contacting the provider. An interrupted/uncertain
        // initialization is not automatically retried, preventing duplicates.
        if (!await deps.store.reserve(id, auth.identity.id)) throw new PaymentHttpError(409, "test_already_reserved");
        const session = await deps.provider().initiate({ id, amountMinor: 100, feedbackUrl: deps.feedbackUrl });
        await deps.store.initiated(id, session);
        return paymentJson({ ...result(id, "pending"), redirectUrl: session.redirectUrl }, 200, cors);
      }
      if (body.action !== "verify" && body.action !== "status") throw new PaymentHttpError(400, "invalid_input");
      const row = await deps.store.get(id);
      if (!row) throw new PaymentHttpError(404, "not_found");
      if (body.action === "status") return paymentJson(result(id, row.status), 200, cors);
      return paymentJson(await verify(deps, row, readProviderTransactionId(body.transactionId)), 200, cors);
    } catch (error) { return failure(error, cors); }
  };
}

export function createPelecardTestFeedbackHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      // Both GET and POST browser returns are informational only. They neither
      // trust supplied status nor call a provider/database operation.
      if (url.searchParams.get("return") === "1" && ["GET", "POST"].includes(request.method)) {
        return paymentJson({ mode: "test", message: "TEST return received; this is not proof of payment. An administrator must check server verification.", commercialEffect: false }, 200);
      }
      if (request.method !== "POST") throw new PaymentHttpError(405, "method_not_allowed");
      assertPelecardTestMode(deps.read);
      const id = identifier(url.searchParams.get("testPaymentId"));
      const parsed = await parsePaymentBody(request, 32_768);
      const envelope = record(parsed.body);
      let notice: Record<string, unknown>;
      try {
        // We explicitly configure resultDataKeyName=testResult at initialization.
        notice = record(typeof envelope.testResult === "string" ? JSON.parse(envelope.testResult) : envelope.testResult);
      } catch { throw new PaymentHttpError(400, "invalid_input"); }
      const row = await deps.store.get(id);
      if (!row) throw new PaymentHttpError(404, "not_found");
      if (!row.confirmation_key || notice.ConfirmationKey !== row.confirmation_key) throw new PaymentError("forged_callback");
      const transactionId = readProviderTransactionId(notice.PelecardTransactionId);
      // PelecardStatusCode in untrusted feedback is intentionally not a decision input.
      return paymentJson(await verify(deps, row, transactionId), 200);
    } catch (error) { return failure(error); }
  };
}
