// Payment source: 3bb2dd7b630e0dc2dfe25498b9ccc8aa5b21b7c7

// supabase/functions/_shared/payment-auth.ts
var STAFF_ROLES = /* @__PURE__ */ new Set([
  "admin",
  "operations",
  "cashier"
]);
async function authorizeStaff(request, authenticator) {
  const header = request.headers.get("Authorization");
  const match = header?.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    return { ok: false, status: 401, code: "missing_authorization" };
  }
  let identity;
  try {
    identity = await authenticator.authenticate(match[1]);
  } catch {
    identity = null;
  }
  if (!identity || !identity.id) {
    return { ok: false, status: 401, code: "invalid_session" };
  }
  if (!STAFF_ROLES.has(identity.role)) {
    return { ok: false, status: 403, code: "forbidden" };
  }
  return {
    ok: true,
    identity
  };
}

// supabase/functions/_shared/payment-http.ts
var PaymentHttpError = class extends Error {
  status;
  code;
  constructor(status, code) {
    super(code);
    this.name = "PaymentHttpError";
    this.status = status;
    this.code = code;
  }
};
function configuredOrigins(origins) {
  if (!Array.isArray(origins) || origins.length === 0) {
    throw new PaymentHttpError(500, "invalid_configuration");
  }
  const normalized = /* @__PURE__ */ new Set();
  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new PaymentHttpError(500, "invalid_configuration");
    }
    if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new PaymentHttpError(500, "invalid_configuration");
    }
    normalized.add(origin);
  }
  return normalized;
}
function paymentCorsHeaders(request, allowedOrigins) {
  const allowed = configuredOrigins(allowedOrigins);
  const origin = request.headers.get("Origin");
  if (origin !== null && !allowed.has(origin)) {
    throw new PaymentHttpError(403, "origin_forbidden");
  }
  const headers = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
  if (origin !== null) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function paymentJson(body, status, corsHeaders = {}) {
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}
async function readPaymentText(request, maxBodyBytes) {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new PaymentHttpError(500, "invalid_configuration");
  }
  const advertisedSize = request.headers.get("Content-Length");
  if (advertisedSize !== null) {
    const size = Number(advertisedSize);
    if (!Number.isFinite(size) || size < 0) {
      throw new PaymentHttpError(400, "invalid_request");
    }
    if (size > maxBodyBytes) {
      throw new PaymentHttpError(413, "body_too_large");
    }
  }
  if (!request.body) throw new PaymentHttpError(400, "invalid_json");
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBodyBytes) {
      try {
        await reader.cancel();
      } catch {
      }
      throw new PaymentHttpError(413, "body_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PaymentHttpError(400, "invalid_json");
  }
}
function paymentContentType(request) {
  return request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
}
async function parsePaymentJson(request, maxBodyBytes) {
  if (paymentContentType(request) !== "application/json") {
    throw new PaymentHttpError(415, "unsupported_media_type");
  }
  const text = await readPaymentText(request, maxBodyBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new PaymentHttpError(400, "invalid_json");
  }
}

// supabase/functions/_shared/payment-handlers.ts
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function methodResponse(request, cors) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return paymentJson({ error: { code: "method_not_allowed" } }, 405, cors);
  }
  return null;
}
function paymentIdBody(value) {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.paymentId !== "string" || !UUID_PATTERN.test(value.paymentId)) {
    throw new PaymentHttpError(400, "invalid_input");
  }
  return value.paymentId;
}
function amountString(amountMinor) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new PaymentHttpError(500, "invalid_storage_response");
  }
  return `${Math.trunc(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}
function statusProjection(payment) {
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
    verifiedAt: payment.verifiedAt
  };
}
function createPelecardStatusHandler(dependencies) {
  return async (request) => {
    let cors = {};
    try {
      cors = paymentCorsHeaders(request, dependencies.config.allowedAppOrigins);
      const early = methodResponse(request, cors);
      if (early) return early;
      const authorization = await authorizeStaff(request, dependencies.auth);
      if (authorization.ok === false) {
        return paymentJson(
          { error: { code: authorization.code } },
          authorization.status,
          cors
        );
      }
      const paymentId = paymentIdBody(await parsePaymentJson(
        request,
        dependencies.config.maxBodyBytes
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

// supabase/functions/_shared/payment-edge-runtime.ts
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

// supabase/functions/_shared/payment-store.ts
var PaymentStoreError = class extends Error {
  constructor() {
    super("storage_unavailable");
    this.name = "PaymentStoreError";
  }
};
function asRecord(value) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new PaymentStoreError();
  }
  return row;
}
function stringField(row, field) {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new PaymentStoreError();
  }
  return value;
}
function nullableString(row, field) {
  const value = row[field];
  if (value === null || value === void 0) return void 0;
  if (typeof value !== "string" || value.length === 0) {
    throw new PaymentStoreError();
  }
  return value;
}
function nullableStringOrNull(row, field) {
  return nullableString(row, field) ?? null;
}
function decimalToMinor(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new PaymentStoreError();
  }
  const amount = Number(value);
  const amountMinor = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(amountMinor)) {
    throw new PaymentStoreError();
  }
  return amountMinor;
}
async function rpc(client, name, parameters) {
  let result;
  try {
    result = await client.rpc(name, parameters);
  } catch {
    throw new PaymentStoreError();
  }
  if (result.error) throw new PaymentStoreError();
  return asRecord(result.data);
}
async function nullableRpc(client, name, parameters) {
  let result;
  try {
    result = await client.rpc(name, parameters);
  } catch {
    throw new PaymentStoreError();
  }
  if (result.error) throw new PaymentStoreError();
  return result.data;
}
function amountDecimal(amountMinor) {
  return `${Math.trunc(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}
function mapVerificationPayment(value) {
  const row = asRecord(value);
  const status = stringField(row, "status");
  if (!(status in {
    initiated: true,
    pending_provider: true,
    succeeded: true,
    failed: true,
    timed_out: true,
    refund_pending: true,
    refunded: true,
    void_pending: true,
    voided: true
  })) {
    throw new PaymentStoreError();
  }
  return {
    id: stringField(row, "id"),
    orderId: nullableStringOrNull(row, "order_id"),
    saleId: nullableStringOrNull(row, "sale_id"),
    amountMinor: decimalToMinor(row.amount),
    currencyCode: stringField(row, "currency"),
    status,
    failureCode: nullableStringOrNull(row, "failure_code"),
    providerTransactionId: nullableStringOrNull(
      row,
      "provider_transaction_id"
    ),
    providerSessionReference: nullableStringOrNull(row, "provider_session_id"),
    receiptNumber: nullableStringOrNull(row, "receipt_number"),
    createdAt: stringField(row, "created_at"),
    updatedAt: stringField(row, "updated_at"),
    verifiedAt: nullableStringOrNull(row, "verified_at")
  };
}
function createSupabasePaymentVerificationStore(client) {
  return {
    async getPayment(paymentId) {
      const data = await nullableRpc(client, "get_pelecard_payment", {
        p_payment_id: paymentId
      });
      return data === null ? null : mapVerificationPayment(data);
    },
    async finalize(paymentId, transaction) {
      return mapVerificationPayment(await rpc(
        client,
        "finalize_pelecard_payment",
        {
          p_payment_id: paymentId,
          p_provider_transaction_id: transaction.providerTransactionId,
          p_approval_id: transaction.approvalId,
          p_provider_status_code: transaction.statusCode,
          p_amount: amountDecimal(transaction.amountMinor),
          p_currency: transaction.currencyCode
        }
      ));
    },
    async markFailed(paymentId, providerStatusCode) {
      return mapVerificationPayment(await rpc(
        client,
        "fail_pelecard_payment",
        {
          p_payment_id: paymentId,
          p_provider_status_code: providerStatusCode,
          p_failure_code: "provider_declined"
        }
      ));
    },
    async recordRejected(paymentId, failureCode, source) {
      await nullableRpc(client, "record_pelecard_verification_rejection", {
        p_payment_id: paymentId,
        p_failure_code: failureCode,
        p_source: source
      });
    }
  };
}

// supabase/functions/_shared/rivhit/client.ts
var DEFAULT_BASE_URL = "https://api.rivhit.co.il/online/RivhitOnlineAPI.svc";
var RETRYABLE_CODES = /* @__PURE__ */ new Set([
  -1,
  -69,
  -70,
  -74,
  -83,
  -119,
  -120,
  -124,
  -125,
  -999,
  -1e3,
  -9998
]);
var CUSTOMER_NOT_FOUND_CODES = /* @__PURE__ */ new Set([-2, -20, -22]);
var PERMANENT_CODES = /* @__PURE__ */ new Set([
  -2,
  -3,
  -4,
  ...Array.from({ length: 41 }, (_, index) => -20 - index),
  -72,
  -107,
  -109,
  -115,
  -116,
  -117,
  -121,
  -122,
  -123,
  -126,
  -127,
  -128,
  -130,
  -131,
  -997,
  -998
]);
var RivhitError = class extends Error {
  retryable;
  reconciliationRequired;
  httpStatus;
  errorCode;
  clientMessage;
  debugMessage;
  constructor(message, options = {}) {
    super(message);
    this.name = "RivhitError";
    this.retryable = options.retryable ?? false;
    this.reconciliationRequired = options.reconciliationRequired ?? false;
    this.httpStatus = options.httpStatus ?? null;
    this.errorCode = options.errorCode ?? null;
    this.clientMessage = options.clientMessage ?? null;
    this.debugMessage = options.debugMessage ?? null;
  }
};
function numberOrNull(value) {
  if (value === null || value === void 0 || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
var RivhitClient = class {
  apiToken;
  fetchImpl;
  baseUrl;
  timeoutMs;
  constructor(options) {
    if (!options.apiToken) {
      throw new Error("RIVHIT_API_TOKEN is not configured");
    }
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 2e4;
  }
  sanitize(value) {
    if (value === null || value === void 0 || value === "") return null;
    return String(value).split(this.apiToken).join("[REDACTED]");
  }
  async post(method, request) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_token: this.apiToken, ...request }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw new RivhitError("Rivhit network request failed", { retryable: true });
    }
    const raw = await response.text();
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new RivhitError("Rivhit returned an invalid JSON response", {
        retryable: response.status >= 500 || response.status === 408 || response.status === 429,
        reconciliationRequired: method === "Document.New" && response.ok,
        httpStatus: response.status
      });
    }
    const errorCode = numberOrNull(envelope.error_code);
    if (!response.ok || errorCode !== null && errorCode !== 0) {
      const reconciliationRequired = errorCode === -107;
      const transientHttp = response.status >= 500 || response.status === 408 || response.status === 429;
      const retryable = errorCode !== null && RETRYABLE_CODES.has(errorCode) || transientHttp && (errorCode === null || !PERMANENT_CODES.has(errorCode));
      const clientMessage = this.sanitize(envelope.client_message);
      const debugMessage = this.sanitize(envelope.debug_message);
      throw new RivhitError(
        debugMessage || clientMessage || `Rivhit request failed with HTTP ${response.status}`,
        {
          retryable,
          reconciliationRequired,
          httpStatus: response.status,
          errorCode,
          clientMessage,
          debugMessage
        }
      );
    }
    return envelope;
  }
  async findCustomerByAccRef(accRef) {
    try {
      const response = await this.post("Customer.Get", { acc_ref: accRef });
      const customerId = response.data?.customer_id;
      if (customerId === null || customerId === void 0 || customerId === "") {
        throw new RivhitError("Rivhit customer response is missing customer_id");
      }
      return { customerId: String(customerId) };
    } catch (error) {
      if (error instanceof RivhitError && (error.errorCode !== null && CUSTOMER_NOT_FOUND_CODES.has(error.errorCode) || /^-(20|22)\s*:\s*CUSTOMER_NOT_EXISTS\b/i.test(error.debugMessage ?? ""))) return null;
      throw error;
    }
  }
  async createCustomer(request) {
    const response = await this.post("Customer.New", request);
    const customerId = response.data?.customer_id;
    if (customerId === null || customerId === void 0 || customerId === "") {
      throw new RivhitError("Rivhit customer response is missing customer_id");
    }
    return { customerId: String(customerId) };
  }
  async createDocument(request) {
    const response = await this.post("Document.New", request);
    const data = response.data;
    if (!data || data.customer_id === null || data.customer_id === void 0 || data.document_type === null || data.document_type === void 0 || data.document_number === null || data.document_number === void 0 || !data.document_identity || !data.document_link) {
      throw new RivhitError("Rivhit document response is missing required fields", {
        reconciliationRequired: true
      });
    }
    return {
      customerId: String(data.customer_id),
      documentType: Number(data.document_type),
      documentId: String(data.document_identity),
      documentNumber: String(data.document_number),
      documentUrl: String(data.document_link),
      amount: numberOrNull(data.amount)
    };
  }
};

// supabase/functions/_shared/rivhit/config.ts
function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}
function requiredBoolean(key, mapping, field) {
  const value = mapping[field];
  if (typeof value !== "boolean") {
    throw new Error(`Invalid Rivhit mapping "${key}": ${field}`);
  }
  return value;
}
function validateMapping(key, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Rivhit mapping "${key}": mapping`);
  }
  const mapping = value;
  if (!isIntegerInRange(mapping.document_type, 1, 999)) {
    throw new Error(`Invalid Rivhit mapping "${key}": document_type`);
  }
  if (!isIntegerInRange(mapping.sort_code, 0, 999)) {
    throw new Error(`Invalid Rivhit mapping "${key}": sort_code`);
  }
  if (!isIntegerInRange(mapping.currency_id, 1, 10)) {
    throw new Error(`Invalid Rivhit mapping "${key}": currency_id`);
  }
  const currencyCode = mapping.currency_code;
  let normalizedCurrencyCode;
  if (currencyCode !== void 0 && (typeof currencyCode !== "string" || !/^[A-Z]{3}$/.test(currencyCode))) {
    throw new Error(`Invalid Rivhit mapping "${key}": currency_code`);
  }
  if (typeof currencyCode === "string") normalizedCurrencyCode = currencyCode;
  return {
    document_type: mapping.document_type,
    sort_code: mapping.sort_code,
    currency_id: mapping.currency_id,
    ...normalizedCurrencyCode === void 0 ? {} : { currency_code: normalizedCurrencyCode },
    price_include_vat: requiredBoolean(key, mapping, "price_include_vat"),
    send_mail: requiredBoolean(key, mapping, "send_mail"),
    digital_signature: requiredBoolean(key, mapping, "digital_signature")
  };
}
function parseDocumentTypeMap(raw) {
  if (!raw) {
    throw new Error("RIVHIT_DOCUMENT_TYPE_MAP is not configured");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("RIVHIT_DOCUMENT_TYPE_MAP is invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("RIVHIT_DOCUMENT_TYPE_MAP must be a JSON object");
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, validateMapping(key, value)])
  );
}
function getDocumentMapping(mappings, key) {
  const mapping = mappings[key];
  if (!mapping) {
    throw new Error(`Rivhit document mapping "${key}" is not configured`);
  }
  return mapping;
}

// supabase/functions/_shared/rivhit/supabase-repository.ts
var AccountingRepositoryIdempotencyError = class extends Error {
  kind;
  constructor(kind) {
    super(`Accounting ${kind} idempotency mismatch`);
    this.name = "AccountingRepositoryIdempotencyError";
    this.kind = kind;
  }
};
function failureMessage(operation, error) {
  const message = error?.message || "unknown Supabase error";
  if (message.includes("accounting customer idempotency mismatch")) {
    return new AccountingRepositoryIdempotencyError("customer");
  }
  if (message.includes("accounting document idempotency mismatch")) {
    return new AccountingRepositoryIdempotencyError("document");
  }
  return new Error(`${operation} failed: ${message}`);
}
function firstRow(operation, result) {
  if (result.error) throw failureMessage(operation, result.error);
  if (!Array.isArray(result.data) || !result.data[0]) {
    throw new Error(`${operation} failed: no claim row returned`);
  }
  return result.data[0];
}
function requireFinalized(operation, result) {
  if (result.error) throw failureMessage(operation, result.error);
  if (result.data !== true) {
    throw new Error(`${operation} failed: stale accounting finalization`);
  }
}
var SupabaseAccountingRepository = class {
  constructor(client, staleAfterSeconds = 300) {
    this.client = client;
    this.staleAfterSeconds = staleAfterSeconds;
  }
  client;
  staleAfterSeconds;
  async claimCustomer(input) {
    const result = await this.client.rpc("claim_accounting_customer", {
      p_provider: input.provider,
      p_account_namespace: input.accountNamespace,
      p_identity_key: input.identityKey,
      p_external_reference: input.externalReference,
      p_stale_after_seconds: this.staleAfterSeconds
    });
    const row = firstRow("claim_accounting_customer", result);
    return {
      id: String(row.id),
      status: row.status,
      externalCustomerId: row.external_customer_id == null ? null : String(row.external_customer_id),
      retryAfter: row.retry_after == null ? null : String(row.retry_after),
      claimed: Boolean(row.claimed),
      attemptCount: Number(row.attempt_count)
    };
  }
  async succeedCustomer(id, attemptCount, externalCustomerId) {
    const result = await this.client.rpc("complete_accounting_customer", {
      p_id: id,
      p_attempt_count: attemptCount,
      p_external_customer_id: externalCustomerId
    });
    requireFinalized("complete_accounting_customer", result);
  }
  async failCustomer(id, attemptCount, failure, externalCustomerId) {
    const result = await this.client.rpc("fail_accounting_customer", {
      p_id: id,
      p_attempt_count: attemptCount,
      p_status: failure.status,
      p_retry_after: failure.retryAfter,
      p_last_error: failure.error,
      p_external_customer_id: externalCustomerId ?? null
    });
    requireFinalized("fail_accounting_customer", result);
  }
  async claimDocument(input) {
    const result = await this.client.rpc("claim_accounting_document", {
      p_provider: input.provider,
      p_account_namespace: input.accountNamespace,
      p_accounting_customer_id: input.accountingCustomerId,
      p_source_type: input.sourceType,
      p_source_id: input.sourceId,
      p_document_type_key: input.documentTypeKey,
      p_external_document_type: input.externalDocumentType,
      p_request_reference: input.requestReference,
      p_payload_hash: input.payloadHash,
      p_stale_after_seconds: this.staleAfterSeconds
    });
    const row = firstRow("claim_accounting_document", result);
    return {
      id: String(row.id),
      status: row.status,
      externalDocumentId: row.external_document_id == null ? null : String(row.external_document_id),
      externalDocumentNumber: row.external_document_number == null ? null : String(row.external_document_number),
      documentUrl: row.document_url == null ? null : String(row.document_url),
      retryAfter: row.retry_after == null ? null : String(row.retry_after),
      claimed: Boolean(row.claimed),
      attemptCount: Number(row.attempt_count)
    };
  }
  async succeedDocument(id, attemptCount, document) {
    const result = await this.client.rpc("complete_accounting_document", {
      p_id: id,
      p_attempt_count: attemptCount,
      p_external_document_id: document.documentId,
      p_external_document_number: document.documentNumber,
      p_document_url: document.documentUrl
    });
    requireFinalized("complete_accounting_document", result);
  }
  async failDocument(id, attemptCount, failure, document) {
    const result = await this.client.rpc("fail_accounting_document", {
      p_id: id,
      p_attempt_count: attemptCount,
      p_status: failure.status,
      p_retry_after: failure.retryAfter,
      p_last_error: failure.error,
      p_external_document_id: document?.documentId ?? null,
      p_external_document_number: document?.documentNumber ?? null,
      p_document_url: document?.documentUrl ?? null
    });
    requireFinalized("fail_accounting_document", result);
  }
};

// supabase/functions/_shared/rivhit/workflow.ts
var LocalPersistenceReconciliationError = class extends RivhitError {
  constructor(kind) {
    super(
      `Rivhit ${kind} succeeded but local persistence requires reconciliation`,
      { reconciliationRequired: true }
    );
  }
};
function persistedError(error) {
  if (error instanceof RivhitError) {
    return {
      message: error.message,
      errorCode: error.errorCode,
      httpStatus: error.httpStatus,
      clientMessage: error.clientMessage,
      debugMessage: error.debugMessage
    };
  }
  return {
    message: error instanceof Error ? error.message : "Unknown accounting error",
    errorCode: null,
    httpStatus: null,
    clientMessage: null,
    debugMessage: null
  };
}
function failureFor(error, attemptCount, now) {
  const rivhitError = error instanceof RivhitError ? error : null;
  const status = rivhitError?.reconciliationRequired ? "reconciliation_required" : rivhitError?.retryable ? "retryable_error" : "permanent_error";
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, attemptCount - 1));
  const retryAfter = status === "retryable_error" ? new Date(now.getTime() + delaySeconds * 1e3).toISOString() : null;
  return { status, retryAfter, error: persistedError(error) };
}
function unclaimedResult(status, retryAfter) {
  return { status, duplicate: true, retryAfter: retryAfter ?? null };
}
async function runRivhitAccounting(options) {
  const { source, repository, client } = options;
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const customerClaim = await repository.claimCustomer({
    provider: source.provider,
    accountNamespace: source.accountNamespace,
    identityKey: source.identityKey,
    externalReference: source.externalCustomerReference
  });
  let externalCustomerId = customerClaim.externalCustomerId;
  if (!customerClaim.claimed) {
    if (customerClaim.status !== "succeeded" || !externalCustomerId) {
      return unclaimedResult(
        customerClaim.status,
        customerClaim.retryAfter
      );
    }
  } else {
    try {
      const found = await client.findCustomerByAccRef(source.externalCustomerReference);
      const customer = found ?? await client.createCustomer(source.customer);
      externalCustomerId = customer.customerId;
      try {
        await repository.succeedCustomer(
          customerClaim.id,
          customerClaim.attemptCount,
          externalCustomerId
        );
      } catch {
        const reconciliationError = new LocalPersistenceReconciliationError("customer");
        try {
          await repository.failCustomer(
            customerClaim.id,
            customerClaim.attemptCount,
            failureFor(reconciliationError, customerClaim.attemptCount, now()),
            externalCustomerId
          );
        } catch {
        }
        throw reconciliationError;
      }
    } catch (error) {
      if (error instanceof LocalPersistenceReconciliationError) throw error;
      await repository.failCustomer(
        customerClaim.id,
        customerClaim.attemptCount,
        failureFor(error, customerClaim.attemptCount, now())
      );
      throw error;
    }
  }
  if (!externalCustomerId) {
    throw new Error("Accounting customer succeeded without an external customer ID");
  }
  const documentClaim = await repository.claimDocument({
    provider: source.provider,
    accountNamespace: source.accountNamespace,
    accountingCustomerId: customerClaim.id,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    documentTypeKey: source.documentTypeKey,
    externalDocumentType: source.document.document_type,
    requestReference: source.documentRequestReference,
    payloadHash: source.payloadHash
  });
  if (!documentClaim.claimed) {
    if (documentClaim.status === "succeeded" && documentClaim.externalDocumentId && documentClaim.externalDocumentNumber && documentClaim.documentUrl) {
      return {
        status: "succeeded",
        duplicate: true,
        customerId: externalCustomerId,
        documentId: documentClaim.externalDocumentId,
        documentNumber: documentClaim.externalDocumentNumber,
        documentUrl: documentClaim.documentUrl
      };
    }
    return unclaimedResult(
      documentClaim.status,
      documentClaim.retryAfter
    );
  }
  try {
    const result = await client.createDocument({
      ...source.document,
      customer_id: Number(externalCustomerId)
    });
    try {
      await repository.succeedDocument(
        documentClaim.id,
        documentClaim.attemptCount,
        result
      );
    } catch {
      const reconciliationError = new LocalPersistenceReconciliationError("document");
      try {
        await repository.failDocument(
          documentClaim.id,
          documentClaim.attemptCount,
          failureFor(reconciliationError, documentClaim.attemptCount, now()),
          result
        );
      } catch {
      }
      throw reconciliationError;
    }
    return {
      status: "succeeded",
      duplicate: false,
      customerId: result.customerId,
      documentId: result.documentId,
      documentNumber: result.documentNumber,
      documentUrl: result.documentUrl
    };
  } catch (error) {
    if (error instanceof LocalPersistenceReconciliationError) throw error;
    await repository.failDocument(
      documentClaim.id,
      documentClaim.attemptCount,
      failureFor(error, documentClaim.attemptCount, now())
    );
    throw error;
  }
}

// supabase/functions/_shared/rivhit/order-mapper.ts
function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function truncate(value, maxLength) {
  return value.trim().slice(0, maxLength);
}
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function identityInput(order, accountingEmail) {
  const companyId = normalizeDigits(order.billing_company_id);
  if (companyId) return `company:${companyId}`;
  if (accountingEmail) return `email:${accountingEmail}`;
  const phone = normalizeDigits(order.client_phone);
  if (phone) return `phone:${phone}`;
  return `order:${order.id}`;
}
var MissingOrderAccountingCustomerIdentityError = class extends Error {
  constructor() {
    super("Order has no accounting customer name");
    this.name = "MissingOrderAccountingCustomerIdentityError";
  }
};
async function mapOrderAccountingCustomerIdentity(order, fallbackName = "Shafan customer") {
  const sourceName = order.billing_institution_name || order.organization || order.client_name;
  if (!sourceName?.trim() && fallbackName === null) {
    throw new MissingOrderAccountingCustomerIdentityError();
  }
  const customerName = truncate(sourceName || fallbackName || "", 30);
  const accountingEmail = normalizeEmail(
    order.billing_accounting_email || order.client_email
  );
  const identityKey = await sha256Hex(identityInput(order, accountingEmail));
  const externalCustomerReference = `sh${identityKey.slice(0, 18)}`;
  const customerRequestReference = `shafan:rivhit:customer:${externalCustomerReference}`;
  const email = accountingEmail || void 0;
  const phone = truncate(String(order.client_phone || ""), 15) || void 0;
  const customer = {
    last_name: customerName,
    ...email ? { email } : {},
    ...phone ? { phone } : {},
    acc_ref: externalCustomerReference,
    request_reference: customerRequestReference
  };
  return {
    customerName,
    accountingEmail,
    identityKey,
    externalCustomerReference,
    customerRequestReference,
    customer
  };
}

// supabase/functions/_shared/payment-accounting/payment-mapper.ts
var DOCUMENT_TYPE_KEY = "payment_success";
var PaymentAccountingReconciliationError = class extends Error {
  code;
  constructor(code) {
    super(code);
    this.name = "PaymentAccountingReconciliationError";
    this.code = code;
  }
};
var PaymentAccountingConfigurationError = class extends Error {
  code;
  constructor(code) {
    super(code);
    this.name = "PaymentAccountingConfigurationError";
    this.code = code;
  }
};
function truncate2(value, maxLength) {
  return value.trim().slice(0, maxLength);
}
function itemDescription(source) {
  const itemNames = source.checkoutItems.map((item) => item.name.trim()).filter(Boolean).join(" + ");
  const orderNumber = source.order?.order_number || source.orderId;
  return truncate2(`${itemNames || "Shafan payment"} / ${orderNumber}`, 30);
}
async function mapVerifiedPaymentToAccountingSource(source, mapping, accountNamespace) {
  if (!accountNamespace.trim()) {
    throw new Error("RIVHIT_ACCOUNT_NAMESPACE is not configured");
  }
  if (!Number.isSafeInteger(source.amountMinor) || source.amountMinor <= 0) {
    throw new Error("Payment has no positive accounting amount");
  }
  if (!mapping.currency_code) {
    throw new PaymentAccountingConfigurationError("missing_currency_code");
  }
  if (mapping.currency_code !== source.currencyCode) {
    throw new PaymentAccountingConfigurationError("currency_mismatch");
  }
  if (!source.order || source.order.id !== source.orderId) {
    throw new PaymentAccountingReconciliationError("missing_order");
  }
  let customerIdentity;
  try {
    customerIdentity = await mapOrderAccountingCustomerIdentity(source.order, null);
  } catch (error) {
    if (error instanceof MissingOrderAccountingCustomerIdentityError) {
      throw new PaymentAccountingReconciliationError("missing_billing_identity");
    }
    throw error;
  }
  const orderNumber = truncate2(source.order.order_number || source.orderId, 15);
  const documentRequestReference = `shafan:rivhit:payment:${source.id}:${DOCUMENT_TYPE_KEY}`;
  const email = customerIdentity.accountingEmail || void 0;
  const document = {
    document_type: mapping.document_type,
    last_name: customerIdentity.customerName,
    ...orderNumber ? { order: orderNumber } : {},
    comments: truncate2(`Shafan payment ${source.id}`, 400),
    sort_code: mapping.sort_code,
    price_include_vat: mapping.price_include_vat,
    currency_id: mapping.currency_id,
    language: "he",
    ...mapping.send_mail && email ? { email_to: email } : {},
    digital_signature: mapping.digital_signature,
    items: [{
      item_id: 0,
      quantity: 1,
      price_nis: source.amountMinor / 100,
      description: itemDescription(source)
    }],
    request_reference: documentRequestReference,
    prevent_duplicates: true,
    create_items: false,
    no_update_inventory: true,
    send_mail: mapping.send_mail
  };
  const payloadHash = await sha256Hex(stableStringify({
    accountNamespace,
    documentTypeKey: DOCUMENT_TYPE_KEY,
    sourceId: source.id,
    paymentAmountMinor: source.amountMinor,
    currencyCode: source.currencyCode,
    checkoutItems: source.checkoutItems.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor
    })),
    externalCustomerReference: customerIdentity.externalCustomerReference,
    document
  }));
  return {
    provider: "rivhit",
    accountNamespace,
    sourceType: "payment_transaction",
    sourceId: source.id,
    documentTypeKey: DOCUMENT_TYPE_KEY,
    paymentAmountMinor: source.amountMinor,
    currencyCode: source.currencyCode,
    identityKey: customerIdentity.identityKey,
    externalCustomerReference: customerIdentity.externalCustomerReference,
    customerRequestReference: customerIdentity.customerRequestReference,
    documentRequestReference,
    payloadHash,
    customer: customerIdentity.customer,
    document
  };
}

// supabase/functions/_shared/payment-accounting/repository.ts
var EVENT_STATUSES = /* @__PURE__ */ new Set([
  "pending",
  "processing",
  "succeeded",
  "retryable_error",
  "permanent_error",
  "reconciliation_required",
  "configuration_required"
]);
var PaymentAccountingRepositoryError = class extends Error {
  code;
  constructor(code, operation) {
    super(`${operation}: ${code}`);
    this.name = "PaymentAccountingRepositoryError";
    this.code = code;
  }
};
var PaymentAccountingSourceStateError = class extends Error {
  code;
  status;
  constructor(code, status = "reconciliation_required") {
    super(code);
    this.name = "PaymentAccountingSourceStateError";
    this.code = code;
    this.status = status;
  }
};
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nullableString2(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !value) return void 0;
  return value;
}
function requiredString(row, field) {
  const value = nullableString2(row[field]);
  return value === void 0 || value === null ? null : value;
}
function nullableRecord(value) {
  if (value === null) return null;
  return isRecord2(value) ? value : void 0;
}
function sourceError(code, status) {
  throw new PaymentAccountingSourceStateError(code, status);
}
function parseMinorAmount(value) {
  let decimal;
  if (typeof value === "string") {
    decimal = value;
  } else if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    decimal = value.toFixed(2);
    if (Number(decimal) !== value) return null;
  } else {
    return null;
  }
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(decimal);
  if (!match) return null;
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}
function checkoutItems(value) {
  const snapshot = nullableRecord(value);
  if (!snapshot || !Array.isArray(snapshot.items) || snapshot.items.length === 0) {
    return sourceError("malformed_checkout");
  }
  return snapshot.items.map((candidate) => {
    if (!isRecord2(candidate)) return sourceError("malformed_checkout");
    const id = requiredString(candidate, "id");
    const name = requiredString(candidate, "name");
    const quantity = candidate.qty;
    const unitPriceMinor = parseMinorAmount(candidate.customPrice);
    if (!id || !name || !Number.isSafeInteger(quantity) || Number(quantity) <= 0 || unitPriceMinor === null) {
      return sourceError("malformed_checkout");
    }
    return {
      id,
      name,
      quantity: Number(quantity),
      unitPriceMinor
    };
  });
}
function eventClaim(value) {
  const row = Array.isArray(value) ? value[0] : null;
  if (!isRecord2(row) || typeof row.claimed !== "boolean") {
    throw new PaymentAccountingRepositoryError("malformed_response", "claim_accounting_event");
  }
  const id = requiredString(row, "id");
  const sourceType = nullableString2(row.source_type);
  const sourceId = nullableString2(row.source_id);
  const purpose = nullableString2(row.purpose);
  const accountingProvider = nullableString2(row.accounting_provider);
  const statusValue = nullableString2(row.status);
  const attemptCount = row.attempt_count === null ? null : Number.isSafeInteger(row.attempt_count) && Number(row.attempt_count) >= 0 ? Number(row.attempt_count) : void 0;
  const leaseToken = nullableString2(row.lease_token);
  const leaseExpiresAt = nullableString2(row.lease_expires_at);
  const lastAttemptAt = nullableString2(row.last_attempt_at);
  const nextAttemptAt = nullableString2(row.next_attempt_at);
  const lastError = nullableRecord(row.last_error);
  const status = statusValue === null ? null : statusValue && EVENT_STATUSES.has(statusValue) ? statusValue : void 0;
  if (!id || sourceType === void 0 || sourceId === void 0 || purpose === void 0 || accountingProvider === void 0 || status === void 0 || attemptCount === void 0 || leaseToken === void 0 || leaseExpiresAt === void 0 || lastAttemptAt === void 0 || nextAttemptAt === void 0 || lastError === void 0 || row.claimed && (status !== "processing" || attemptCount === null || attemptCount < 1 || !leaseToken || !leaseExpiresAt)) {
    throw new PaymentAccountingRepositoryError("malformed_response", "claim_accounting_event");
  }
  return {
    id,
    sourceType,
    sourceId,
    purpose,
    accountingProvider,
    status,
    claimed: row.claimed,
    attemptCount,
    leaseToken,
    leaseExpiresAt,
    lastAttemptAt,
    nextAttemptAt,
    lastError
  };
}
async function rpc2(client, operation, args) {
  try {
    const result = await client.rpc(operation, args);
    if (result.error) {
      throw new PaymentAccountingRepositoryError("database_error", operation);
    }
    return result;
  } catch (error) {
    if (error instanceof PaymentAccountingRepositoryError) throw error;
    throw new PaymentAccountingRepositoryError("database_error", operation);
  }
}
async function selectOne(client, table, columns, filters) {
  try {
    let query = client.from(table).select(columns);
    for (const [column, value] of filters) query = query.eq(column, value);
    const result = await query.maybeSingle();
    if (result.error) {
      throw new PaymentAccountingRepositoryError("database_error", `load_${table}`);
    }
    return result.data ?? null;
  } catch (error) {
    if (error instanceof PaymentAccountingRepositoryError) throw error;
    throw new PaymentAccountingRepositoryError("database_error", `load_${table}`);
  }
}
function optionalOrderString(row, field) {
  const value = nullableString2(row[field]);
  if (value === void 0) return sourceError("malformed_linked_order");
  return value;
}
function optionalOrderNumber(row, field) {
  const value = row[field];
  if (value === null) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return sourceError("malformed_linked_order");
}
function optionalOrderInteger(row, field) {
  const value = row[field];
  if (value === null) return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  return sourceError("malformed_linked_order");
}
function mapOrder(value, expectedId) {
  if (!isRecord2(value)) return sourceError("missing_linked_order");
  const id = requiredString(value, "id");
  const orderNumber = optionalOrderString(value, "order_number");
  const clientName = requiredString(value, "client_name");
  const clientPhone = requiredString(value, "client_phone");
  const activityId = optionalOrderString(value, "activity_id");
  if (!id || id !== expectedId || !orderNumber || !clientName || !clientPhone) {
    return sourceError("malformed_linked_order");
  }
  return {
    order: {
      id,
      order_number: orderNumber,
      client_name: clientName,
      client_phone: clientPhone,
      client_email: optionalOrderString(value, "client_email"),
      organization: optionalOrderString(value, "organization"),
      billing_institution_name: optionalOrderString(value, "billing_institution_name"),
      billing_company_id: optionalOrderString(value, "billing_company_id"),
      billing_accounting_email: optionalOrderString(value, "billing_accounting_email"),
      num_participants: optionalOrderInteger(value, "num_participants"),
      price_per_person: optionalOrderNumber(value, "price_per_person"),
      total_price: optionalOrderNumber(value, "total_price")
    },
    activityId
  };
}
var SupabasePaymentAccountingRepository = class {
  constructor(client) {
    this.client = client;
  }
  client;
  async claimEvent(eventId, workerId, leaseSeconds, forceRetry) {
    const result = await rpc2(this.client, "claim_accounting_event", {
      p_event_id: eventId,
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
      p_force_retry: forceRetry
    });
    return eventClaim(result.data);
  }
  async completeEvent(fence) {
    const result = await rpc2(this.client, "complete_accounting_event", {
      p_event_id: fence.id,
      p_attempt_count: fence.attemptCount,
      p_lease_token: fence.leaseToken
    });
    if (result.data !== true) {
      throw new PaymentAccountingRepositoryError(
        "stale_event_fence",
        "complete_accounting_event"
      );
    }
  }
  async failEvent(fence, failure) {
    const result = await rpc2(this.client, "fail_accounting_event", {
      p_event_id: fence.id,
      p_attempt_count: fence.attemptCount,
      p_lease_token: fence.leaseToken,
      p_status: failure.status,
      p_next_attempt_at: failure.nextAttemptAt,
      p_last_error: failure.error
    });
    if (result.data !== true) {
      throw new PaymentAccountingRepositoryError(
        "stale_event_fence",
        "fail_accounting_event"
      );
    }
  }
  async findEventIdForPayment(paymentId) {
    const value = await selectOne(
      this.client,
      "accounting_events",
      "id",
      [
        ["source_type", "payment_transaction"],
        ["source_id", paymentId],
        ["purpose", "payment_success"],
        ["accounting_provider", "rivhit"]
      ]
    );
    if (value === null) return null;
    if (!isRecord2(value) || !requiredString(value, "id")) {
      throw new PaymentAccountingRepositoryError(
        "malformed_response",
        "load_accounting_events"
      );
    }
    return requiredString(value, "id");
  }
  async loadVerifiedPelecardPayment(sourceId) {
    const value = await selectOne(
      this.client,
      "payment_transactions",
      "id,provider,operation,order_id,sale_id,provider_transaction_id,amount,currency,status,verified_at,checkout_snapshot",
      [["id", sourceId]]
    );
    if (value === null) return sourceError("source_not_found");
    if (!isRecord2(value)) return sourceError("source_not_found");
    if (value.provider !== "pelecard") {
      return sourceError("wrong_provider", "permanent_error");
    }
    if (value.operation !== "payment") {
      return sourceError("wrong_operation", "permanent_error");
    }
    if (value.status !== "succeeded") return sourceError("payment_not_succeeded");
    const id = requiredString(value, "id");
    const orderId = nullableString2(value.order_id);
    const saleId = requiredString(value, "sale_id");
    const providerTransactionId = requiredString(value, "provider_transaction_id");
    const verifiedAt = requiredString(value, "verified_at");
    const currencyCode = requiredString(value, "currency");
    const amountMinor = parseMinorAmount(value.amount);
    if (!id || id !== sourceId) return sourceError("source_not_found");
    if (orderId === void 0) return sourceError("missing_linked_order");
    if (!saleId) return sourceError("missing_sale");
    if (!providerTransactionId) return sourceError("missing_provider_transaction");
    if (!verifiedAt) return sourceError("payment_not_verified");
    if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) {
      return sourceError("malformed_currency");
    }
    if (amountMinor === null || amountMinor <= 0) return sourceError("malformed_amount");
    const items = checkoutItems(value.checkout_snapshot);
    let order = null;
    let activityName = null;
    if (orderId !== null) {
      const orderValue = await selectOne(
        this.client,
        "orders",
        "id,order_number,client_name,client_phone,client_email,organization,activity_id,num_participants,price_per_person,total_price,billing_institution_name,billing_company_id,billing_accounting_email",
        [["id", orderId]]
      );
      const mapped = mapOrder(orderValue, orderId);
      order = mapped.order;
      if (mapped.activityId) {
        const activityValue = await selectOne(
          this.client,
          "activities",
          "name",
          [["id", mapped.activityId]]
        );
        if (!isRecord2(activityValue) || !requiredString(activityValue, "name")) {
          return sourceError("malformed_activity");
        }
        activityName = requiredString(activityValue, "name");
      }
    }
    return {
      id,
      provider: "pelecard",
      operation: "payment",
      status: "succeeded",
      orderId,
      saleId,
      providerTransactionId,
      amountMinor,
      currencyCode,
      verifiedAt,
      checkoutItems: items,
      order,
      activityName
    };
  }
};

// supabase/functions/_shared/payment-accounting/processor.ts
var ProcessorConfigurationError = class extends Error {
  code;
  constructor(code) {
    super(code);
    this.name = "ProcessorConfigurationError";
    this.code = code;
  }
};
var InvalidAccountingEventSourceError = class extends Error {
  code = "invalid_accounting_event_source";
};
function eventFence(claim) {
  if (claim.attemptCount === null || claim.attemptCount < 1 || !claim.leaseToken) {
    throw new PaymentAccountingRepositoryError(
      "malformed_response",
      "claim_accounting_event"
    );
  }
  return {
    id: claim.id,
    attemptCount: claim.attemptCount,
    leaseToken: claim.leaseToken
  };
}
function retryAt(attemptCount, now, innerRetryAfter) {
  const exponent = Math.min(6, Math.max(0, attemptCount - 1));
  const delaySeconds = Math.min(3600, 60 * 2 ** exponent);
  const outerRetryTime = now.getTime() + delaySeconds * 1e3;
  const innerRetryTime = innerRetryAfter ? Date.parse(innerRetryAfter) : Number.NaN;
  const selectedRetryTime = Number.isFinite(innerRetryTime) && innerRetryTime > now.getTime() ? innerRetryTime : outerRetryTime;
  return new Date(selectedRetryTime).toISOString();
}
function controlledError(status, code, error) {
  return {
    code,
    message: status === "configuration_required" ? "Accounting configuration is incomplete" : status === "reconciliation_required" ? "Accounting requires manual reconciliation" : status === "retryable_error" ? "Accounting operation can be retried" : "Accounting source or request is invalid",
    ...error ? {
      errorCode: error.errorCode,
      httpStatus: error.httpStatus,
      retryable: error.retryable,
      reconciliationRequired: error.reconciliationRequired
    } : {}
  };
}
function classifiedFailure(error, attemptCount, now) {
  let status;
  let code;
  let rivhitError;
  if (error instanceof ProcessorConfigurationError || error instanceof PaymentAccountingConfigurationError) {
    status = "configuration_required";
    code = error.code;
  } else if (error instanceof PaymentAccountingReconciliationError) {
    status = "reconciliation_required";
    code = error.code;
  } else if (error instanceof PaymentAccountingSourceStateError) {
    status = error.status;
    code = error.code;
  } else if (error instanceof InvalidAccountingEventSourceError) {
    status = "permanent_error";
    code = error.code;
  } else if (error instanceof AccountingRepositoryIdempotencyError) {
    status = "reconciliation_required";
    code = `rivhit_${error.kind}_idempotency_mismatch`;
  } else if (error instanceof RivhitError) {
    rivhitError = error;
    status = error.reconciliationRequired ? "reconciliation_required" : error.retryable ? "retryable_error" : "permanent_error";
    code = "rivhit_error";
  } else if (error instanceof PaymentAccountingRepositoryError) {
    status = "retryable_error";
    code = error.code;
  } else {
    status = "retryable_error";
    code = "accounting_runtime_error";
  }
  return {
    status,
    nextAttemptAt: status === "retryable_error" ? retryAt(attemptCount, now) : null,
    error: controlledError(status, code, rivhitError)
  };
}
function workflowFailure(result, attemptCount, now) {
  const status = result.status === "permanent_error" ? "permanent_error" : result.status === "reconciliation_required" ? "reconciliation_required" : "retryable_error";
  return {
    status,
    nextAttemptAt: status === "retryable_error" ? retryAt(attemptCount, now, result.retryAfter) : null,
    error: controlledError(status, `rivhit_workflow_${result.status}`)
  };
}
function validateClaimedSource(claim) {
  if (claim.sourceType !== "payment_transaction" || claim.purpose !== "payment_success" || claim.accountingProvider !== "rivhit" || !claim.sourceId) {
    throw new InvalidAccountingEventSourceError();
  }
  return claim.sourceId;
}
async function processPaymentAccountingEvent(options) {
  const claim = await options.repository.claimEvent(
    options.eventId,
    options.workerId,
    options.leaseSeconds ?? 300,
    options.forceRetry ?? false
  );
  if (!claim.claimed) {
    return {
      eventId: claim.id,
      status: claim.status,
      claimed: false,
      duplicate: true,
      retryAfter: claim.nextAttemptAt
    };
  }
  if (claim.id !== options.eventId) {
    throw new PaymentAccountingRepositoryError(
      "malformed_response",
      "claim_accounting_event"
    );
  }
  const fence = eventFence(claim);
  let workflowResult;
  try {
    const sourceId = validateClaimedSource(claim);
    if (options.configurationIssue) {
      throw new ProcessorConfigurationError(options.configurationIssue);
    }
    if (!options.accountNamespace.trim()) {
      throw new ProcessorConfigurationError("missing_account_namespace");
    }
    let mapping;
    try {
      mapping = getDocumentMapping(options.documentMappings, "payment_success");
    } catch {
      throw new ProcessorConfigurationError("missing_document_mapping");
    }
    const payment = await options.repository.loadVerifiedPelecardPayment(sourceId);
    const source = await mapVerifiedPaymentToAccountingSource(
      payment,
      mapping,
      options.accountNamespace
    );
    if (!options.rivhitClient) {
      throw new ProcessorConfigurationError("missing_rivhit_api_token");
    }
    workflowResult = await runRivhitAccounting({
      source,
      repository: options.rivhitRepository,
      client: options.rivhitClient,
      now: options.now
    });
  } catch (error) {
    const failure = classifiedFailure(
      error,
      fence.attemptCount,
      (options.now ?? (() => /* @__PURE__ */ new Date()))()
    );
    await options.repository.failEvent(fence, failure);
    return {
      eventId: claim.id,
      status: failure.status,
      claimed: true,
      duplicate: false,
      retryAfter: failure.nextAttemptAt
    };
  }
  if (workflowResult.status !== "succeeded") {
    const failure = workflowFailure(
      workflowResult,
      fence.attemptCount,
      (options.now ?? (() => /* @__PURE__ */ new Date()))()
    );
    await options.repository.failEvent(fence, failure);
    return {
      eventId: claim.id,
      status: failure.status,
      claimed: true,
      duplicate: true,
      retryAfter: failure.nextAttemptAt
    };
  }
  await options.repository.completeEvent(fence);
  return {
    eventId: claim.id,
    status: "succeeded",
    claimed: true,
    duplicate: workflowResult.duplicate,
    retryAfter: null,
    documentId: workflowResult.documentId,
    documentNumber: workflowResult.documentNumber,
    documentUrl: workflowResult.documentUrl
  };
}

// supabase/functions/_shared/payment-accounting/runtime.ts
function trimmed(value) {
  return value?.trim() ?? "";
}
function accountingConfiguration(env, createClient2) {
  const apiToken = trimmed(env.RIVHIT_API_TOKEN);
  const mode = trimmed(env.RIVHIT_ACCOUNTING_MODE);
  const accountNamespace = trimmed(env.RIVHIT_ACCOUNT_NAMESPACE);
  if (!apiToken) return { issue: "missing_rivhit_api_token", mappings: {}, accountNamespace };
  if (mode !== "sandbox" && mode !== "production") {
    return { issue: "invalid_accounting_mode", mappings: {}, accountNamespace };
  }
  if (!accountNamespace) {
    return { issue: "missing_account_namespace", mappings: {}, accountNamespace };
  }
  let mappings;
  try {
    mappings = parseDocumentTypeMap(env.RIVHIT_DOCUMENT_TYPE_MAP);
  } catch {
    return { issue: "invalid_document_mapping", mappings: {}, accountNamespace };
  }
  try {
    const paymentMapping = getDocumentMapping(mappings, "payment_success");
    if (!paymentMapping.currency_code) {
      return { issue: "missing_currency_code", mappings, accountNamespace };
    }
  } catch {
    return { issue: "missing_document_mapping", mappings, accountNamespace };
  }
  return {
    mappings,
    accountNamespace,
    client: createClient2(apiToken)
  };
}
function createPaymentAccountingRuntime(options) {
  const repository = new SupabasePaymentAccountingRepository(options.serviceClient);
  const rivhitRepository = new SupabaseAccountingRepository(options.serviceClient);
  const run = options.processEvent ?? processPaymentAccountingEvent;
  const createClient2 = options.createRivhitClient ?? ((apiToken) => new RivhitClient({ apiToken }));
  const configuration = accountingConfiguration(options.env, createClient2);
  const workerId = options.workerId ?? `payment-accounting:${crypto.randomUUID()}`;
  const processEvent = (eventId, forceRetry = false) => run({
    eventId,
    workerId,
    leaseSeconds: options.leaseSeconds ?? 300,
    forceRetry,
    repository,
    rivhitRepository,
    rivhitClient: configuration.client,
    documentMappings: configuration.mappings,
    accountNamespace: configuration.accountNamespace,
    configurationIssue: configuration.issue
  });
  return {
    configurationIssue: configuration.issue,
    processEvent,
    async wakePaymentAccounting(paymentId) {
      const durableEventId = await repository.findEventIdForPayment(paymentId);
      if (!durableEventId) return;
      await processEvent(durableEventId, false);
    }
  };
}

// supabase/functions/_shared/payment-edge-runtime.ts
function requireEnv(name) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("invalid_configuration");
  return value;
}
function commaList(name) {
  const values = requireEnv(name).split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) throw new Error("invalid_configuration");
  return values;
}
function accountingEnv() {
  return {
    RIVHIT_API_TOKEN: Deno.env.get("RIVHIT_API_TOKEN"),
    RIVHIT_ACCOUNTING_MODE: Deno.env.get("RIVHIT_ACCOUNTING_MODE"),
    RIVHIT_ACCOUNT_NAMESPACE: Deno.env.get("RIVHIT_ACCOUNT_NAMESPACE"),
    RIVHIT_DOCUMENT_TYPE_MAP: Deno.env.get("RIVHIT_DOCUMENT_TYPE_MAP")
  };
}
function createSupabaseEdgeRuntime() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const auth = {
    async authenticate(accessToken) {
      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false }
      });
      const { data: { user }, error: userError } = await callerClient.auth.getUser(accessToken);
      if (userError || !user) return null;
      const { data: profile, error: profileError } = await callerClient.from("profiles").select("role").eq("id", user.id).single();
      if (profileError || !profile || typeof profile.role !== "string") {
        return null;
      }
      return { id: user.id, role: profile.role };
    }
  };
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return { auth, serviceClient };
}
function createPaymentEdgeRuntime() {
  const { auth, serviceClient } = createSupabaseEdgeRuntime();
  const config = {
    allowedAppOrigins: commaList("PAYMENTS_APP_ORIGINS"),
    maxBodyBytes: 32768,
    terminalReference: requireEnv("PELECARD_TERMINAL"),
    successfulProviderStatusCodes: commaList(
      "PELECARD_SUCCESS_STATUS_CODES"
    ),
    failedProviderStatusCodes: (Deno.env.get("PELECARD_FAILURE_STATUS_CODES") ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  };
  return {
    auth,
    config,
    store: createSupabasePaymentVerificationStore(serviceClient),
    accounting: createPaymentAccountingRuntime({
      serviceClient,
      env: accountingEnv()
    })
  };
}
function servePaymentHandler(createHandler) {
  Deno.serve(async (request) => {
    try {
      return await createHandler()(request);
    } catch {
      return new Response(JSON.stringify({
        error: { code: "invalid_configuration" }
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }
  });
}

// supabase/functions/pelecard-status/index.ts
servePaymentHandler(() => {
  const runtime = createPaymentEdgeRuntime();
  return createPelecardStatusHandler({
    auth: runtime.auth,
    store: runtime.store,
    config: runtime.config
  });
});
