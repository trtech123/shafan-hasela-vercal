import type {
  RivhitCustomerDraft,
  RivhitCustomerResult,
  RivhitDocumentResult,
} from "./types.ts";

const DEFAULT_BASE_URL = "https://api.rivhit.co.il/online/RivhitOnlineAPI.svc";
const RETRYABLE_CODES = new Set([
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
  -1000,
  -9998,
]);
const CUSTOMER_NOT_FOUND_CODES = new Set([-2, -20, -22]);
// Documented validation/business errors must not be retried merely because
// Rivhit commonly transports them with HTTP 500.
const PERMANENT_CODES = new Set([
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
  -998,
]);

interface RivhitErrorOptions {
  retryable?: boolean;
  reconciliationRequired?: boolean;
  httpStatus?: number | null;
  errorCode?: number | null;
  clientMessage?: string | null;
  debugMessage?: string | null;
}

export class RivhitError extends Error {
  retryable: boolean;
  reconciliationRequired: boolean;
  httpStatus: number | null;
  errorCode: number | null;
  clientMessage: string | null;
  debugMessage: string | null;

  constructor(message: string, options: RivhitErrorOptions = {}) {
    super(message);
    this.name = "RivhitError";
    this.retryable = options.retryable ?? false;
    this.reconciliationRequired = options.reconciliationRequired ?? false;
    this.httpStatus = options.httpStatus ?? null;
    this.errorCode = options.errorCode ?? null;
    this.clientMessage = options.clientMessage ?? null;
    this.debugMessage = options.debugMessage ?? null;
  }
}

interface RivhitClientOptions {
  apiToken: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  allowDocumentCreation?: boolean;
}

interface RivhitEnvelope {
  error_code?: number | string;
  client_message?: string | null;
  debug_message?: string | null;
  data?: Record<string, unknown> | null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export class RivhitClient {
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly allowDocumentCreation: boolean;

  constructor(options: RivhitClientOptions) {
    if (!options.apiToken) {
      throw new Error("RIVHIT_API_TOKEN is not configured");
    }
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.allowDocumentCreation = options.allowDocumentCreation === true;
  }

  private sanitize(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;
    return String(value).split(this.apiToken).join("[REDACTED]");
  }

  private async post(method: string, request: Record<string, unknown>): Promise<RivhitEnvelope> {
    const issuing = method === "Document.New";
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_token: this.apiToken, ...request }),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RivhitError("Rivhit network request failed", {
        retryable: !issuing, reconciliationRequired: issuing,
      });
    }

    let raw: string;
    try { raw = await response.text(); } catch {
      throw new RivhitError("Rivhit response could not be read", {
        retryable: !issuing, reconciliationRequired: issuing, httpStatus: response.status,
      });
    }
    let envelope: RivhitEnvelope;
    try {
      envelope = JSON.parse(raw) as RivhitEnvelope;
    } catch {
      throw new RivhitError("Rivhit returned an invalid JSON response", {
        retryable: !issuing && (response.status >= 500 || response.status === 408 || response.status === 429),
        reconciliationRequired: issuing,
        httpStatus: response.status,
      });
    }

    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw new RivhitError("Rivhit returned an invalid response envelope", { reconciliationRequired: issuing });
    }
    const errorCode = numberOrNull(envelope.error_code);
    if (issuing && errorCode === null) {
      throw new RivhitError("Rivhit document response has no explicit result", { reconciliationRequired: true });
    }
    if (!response.ok || (errorCode !== null && errorCode !== 0)) {
      const reconciliationRequired = errorCode === -107 || (issuing && (errorCode === null || !PERMANENT_CODES.has(errorCode)));
      const transientHttp = response.status >= 500
        || response.status === 408
        || response.status === 429;
      const retryable = !issuing && ((errorCode !== null && RETRYABLE_CODES.has(errorCode))
        || (transientHttp && (errorCode === null || !PERMANENT_CODES.has(errorCode))));
      const clientMessage = issuing ? null : this.sanitize(envelope.client_message);
      const debugMessage = issuing ? null : this.sanitize(envelope.debug_message);
      throw new RivhitError(
        debugMessage || clientMessage || `Rivhit request failed with HTTP ${response.status}`,
        {
          retryable,
          reconciliationRequired,
          httpStatus: response.status,
          errorCode,
          clientMessage,
          debugMessage,
        },
      );
    }

    return envelope;
  }

  async findCustomerByAccRef(accRef: string): Promise<RivhitCustomerResult | null> {
    try {
      const response = await this.post("Customer.Get", { acc_ref: accRef });
      const customerId = response.data?.customer_id;
      if (customerId === null || customerId === undefined || customerId === "") {
        throw new RivhitError("Rivhit customer response is missing customer_id");
      }
      return { customerId: String(customerId) };
    } catch (error) {
      if (
        error instanceof RivhitError
        && (
          (error.errorCode !== null && CUSTOMER_NOT_FOUND_CODES.has(error.errorCode))
          || /^-(20|22)\s*:\s*CUSTOMER_NOT_EXISTS\b/i.test(error.debugMessage ?? "")
        )
      ) return null;
      throw error;
    }
  }

  async readConfiguration(method: "Company.Details" | "Accounting.VatRate" | "Document.TypeList" | "Payment.TypeList"): Promise<Record<string, unknown>> {
    if (!["Company.Details", "Accounting.VatRate", "Document.TypeList", "Payment.TypeList"].includes(method)) {
      throw new RivhitError("Configuration method not allowed");
    }
    try {
      const response = await this.post(method, {});
      if (numberOrNull(response.error_code) !== 0 || !response.data || typeof response.data !== "object" || Array.isArray(response.data)) throw Error();
      return response.data;
    } catch { throw new RivhitError("Rivhit account configuration unavailable"); }
  }

  /** Read-only recovery. No missing/failed lookup authorizes another issuance. */
  async lookupDocumentRequest(requestReference: string): Promise<unknown> {
    if (!requestReference.trim()) throw new RivhitError("Missing Rivhit request reference", { reconciliationRequired: true });
    try {
      const response = await this.post("Status.LastRequest/json", { request_reference: requestReference });
      if (numberOrNull(response.error_code) !== 0 || typeof response.data !== "string") throw Error();
      const stored: unknown = JSON.parse(response.data);
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw Error();
      const envelope = stored as Record<string, unknown>;
      if (numberOrNull(envelope.error_code) !== 0 || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) throw Error();
      return envelope.data;
    } catch {
      throw new RivhitError("Rivhit issuance outcome remains uncertain", { reconciliationRequired: true });
    }
  }

  async getDocumentDetails(documentType: number, documentNumber: number): Promise<unknown> {
    if (!Number.isSafeInteger(documentType) || documentType < 1 || documentType > 999 || !Number.isSafeInteger(documentNumber) || documentNumber < 1) {
      throw new RivhitError("Invalid Rivhit document identity", { reconciliationRequired: true });
    }
    try {
      const response = await this.post("Document.Details", { document_type: documentType, document_number: documentNumber });
      if (numberOrNull(response.error_code) !== 0 || !response.data) throw Error();
      return response.data;
    } catch {
      throw new RivhitError("Rivhit document verification remains uncertain", { reconciliationRequired: true });
    }
  }

  async lookupCustomerRequest(requestReference: string): Promise<RivhitCustomerResult> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestReference)) {
      throw new RivhitError("Invalid customer request reference", { reconciliationRequired: true });
    }
    const recovered = await this.lookupDocumentRequest(requestReference) as Record<string, unknown>;
    const id = String(recovered.customer_id ?? "");
    if (!/^[1-9]\d*$/.test(id) || "document_number" in recovered || "document_identity" in recovered) {
      throw new RivhitError("Customer creation remains uncertain", { reconciliationRequired: true });
    }
    return { customerId: id };
  }

  async getCustomerById(customerId: string): Promise<{customerId:string;name:string;email:string;phone:string;companyId?:string}> {
    try {
      if (!/^[1-9]\d*$/.test(customerId) || !Number.isSafeInteger(Number(customerId))) throw Error();
      const response = await this.post("Customer.Get", { customer_id: Number(customerId) });
      const value = response.data;
      if (numberOrNull(response.error_code) !== 0 || !value || String(value.customer_id) !== customerId ||
        typeof value.last_name !== "string" || !value.last_name.trim()) throw Error();
      const companyId = String(value.id_number ?? "").trim();
      if (companyId && !/^0+$/.test(companyId) && !/^\d{9}$/.test(companyId)) throw Error();
      return { customerId, name: value.last_name.trim(), email: String(value.email ?? "").trim(),
        phone: String(value.phone ?? "").trim(), ...(companyId && !/^0+$/.test(companyId) ? {companyId} : {}) };
    } catch {
      throw new RivhitError("Customer identity verification remains uncertain", { reconciliationRequired: true });
    }
  }

  async createCustomer(request: RivhitCustomerDraft): Promise<RivhitCustomerResult> {
    const response = await this.post("Customer.New", request as unknown as Record<string, unknown>);
    const customerId = response.data?.customer_id;
    if (customerId === null || customerId === undefined || customerId === "") {
      throw new RivhitError("Rivhit customer response is missing customer_id");
    }
    return { customerId: String(customerId) };
  }

  async createDocument(
    request: Record<string, unknown>,
  ): Promise<RivhitDocumentResult> {
    if (!this.allowDocumentCreation) throw new RivhitError("Rivhit document issuance is disabled");
    if (typeof request.request_reference !== "string" || !request.request_reference.trim() || request.prevent_duplicates !== true) {
      throw new RivhitError("Rivhit document requires stable duplicate protection");
    }
    const response = await this.post("Document.New", request);
    const data = response.data;
    if (
      !data
      || data.customer_id === null
      || data.customer_id === undefined
      || data.document_type === null
      || data.document_type === undefined
      || data.document_number === null
      || data.document_number === undefined
      || !data.document_identity
      || !data.document_link
    ) {
      throw new RivhitError("Rivhit document response is missing required fields", {
        reconciliationRequired: true,
      });
    }

    return {
      customerId: String(data.customer_id),
      documentType: Number(data.document_type),
      documentId: String(data.document_identity),
      documentNumber: String(data.document_number),
      documentUrl: String(data.document_link),
      amount: numberOrNull(data.amount),
    };
  }
}
