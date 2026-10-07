import type {
  RivhitCustomerDraft,
  RivhitCustomerResult,
  RivhitDocumentResult,
} from "../../../_shared/rivhit/types.ts";

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

  constructor(options: RivhitClientOptions) {
    if (!options.apiToken) {
      throw new Error("RIVHIT_API_TOKEN is not configured");
    }
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  private sanitize(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;
    return String(value).split(this.apiToken).join("[REDACTED]");
  }

  private async post(method: string, request: Record<string, unknown>): Promise<RivhitEnvelope> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_token: this.apiToken, ...request }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RivhitError("Rivhit network request failed", { retryable: true });
    }

    const raw = await response.text();
    let envelope: RivhitEnvelope;
    try {
      envelope = JSON.parse(raw) as RivhitEnvelope;
    } catch {
      throw new RivhitError("Rivhit returned an invalid JSON response", {
        retryable: response.status >= 500 || response.status === 408 || response.status === 429,
        reconciliationRequired: method === "Document.New" && response.ok,
        httpStatus: response.status,
      });
    }

    const errorCode = numberOrNull(envelope.error_code);
    if (!response.ok || (errorCode !== null && errorCode !== 0)) {
      const reconciliationRequired = errorCode === -107;
      const transientHttp = response.status >= 500
        || response.status === 408
        || response.status === 429;
      const retryable = (errorCode !== null && RETRYABLE_CODES.has(errorCode))
        || (transientHttp && (errorCode === null || !PERMANENT_CODES.has(errorCode)));
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
