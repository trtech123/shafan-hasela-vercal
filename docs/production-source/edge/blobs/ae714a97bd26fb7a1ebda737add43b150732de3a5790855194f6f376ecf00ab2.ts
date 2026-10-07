import type { RivhitDocumentResult } from "./types.ts";
import type {
  AccountingRepository,
  ClaimCustomerInput,
  ClaimDocumentInput,
  CustomerClaim,
  DocumentClaim,
  PersistedFailure,
} from "./workflow.ts";

interface SupabaseResult<T = unknown> {
  data?: T;
  error?: { message?: string } | null;
}

interface SupabaseClientLike {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<SupabaseResult>;
}

export class AccountingRepositoryIdempotencyError extends Error {
  readonly kind: "customer" | "document";

  constructor(kind: AccountingRepositoryIdempotencyError["kind"]) {
    super(`Accounting ${kind} idempotency mismatch`);
    this.name = "AccountingRepositoryIdempotencyError";
    this.kind = kind;
  }
}

function failureMessage(operation: string, error: { message?: string } | null | undefined): Error {
  const message = error?.message || "unknown Supabase error";
  if (message.includes("accounting customer idempotency mismatch")) {
    return new AccountingRepositoryIdempotencyError("customer");
  }
  if (message.includes("accounting document idempotency mismatch")) {
    return new AccountingRepositoryIdempotencyError("document");
  }
  return new Error(`${operation} failed: ${message}`);
}

function firstRow(operation: string, result: SupabaseResult): Record<string, unknown> {
  if (result.error) throw failureMessage(operation, result.error);
  if (!Array.isArray(result.data) || !result.data[0]) {
    throw new Error(`${operation} failed: no claim row returned`);
  }
  return result.data[0] as Record<string, unknown>;
}

function requireFinalized(operation: string, result: SupabaseResult): void {
  if (result.error) throw failureMessage(operation, result.error);
  if (result.data !== true) {
    throw new Error(`${operation} failed: stale accounting finalization`);
  }
}

export class SupabaseAccountingRepository implements AccountingRepository {
  constructor(
    private readonly client: SupabaseClientLike,
    private readonly staleAfterSeconds = 300,
  ) {}

  async assertSourceAllowed(sourceId: string): Promise<void> {
    const result = await this.client.rpc("is_pelecard_controlled_live_accounting_held", {
      p_source_id: sourceId,
    });
    if (result.error || typeof result.data !== "boolean") {
      throw new Error("accounting_hold_lookup_failed");
    }
    if (result.data) throw new Error("controlled_live_accounting_hold");
  }

  async claimCustomer(input: ClaimCustomerInput): Promise<CustomerClaim> {
    const result = await this.client.rpc("claim_accounting_customer", {
      p_provider: input.provider,
      p_account_namespace: input.accountNamespace,
      p_identity_key: input.identityKey,
      p_external_reference: input.externalReference,
      p_stale_after_seconds: this.staleAfterSeconds,
    });
    const row = firstRow("claim_accounting_customer", result);
    return {
      id: String(row.id),
      status: row.status as CustomerClaim["status"],
      externalCustomerId: row.external_customer_id == null
        ? null
        : String(row.external_customer_id),
      retryAfter: row.retry_after == null ? null : String(row.retry_after),
      claimed: Boolean(row.claimed),
      attemptCount: Number(row.attempt_count),
    };
  }

  async succeedCustomer(
    id: string,
    attemptCount: number,
    externalCustomerId: string,
  ): Promise<void> {
    const result = await this.client.rpc("complete_accounting_customer", {
      p_id: id,
      p_attempt_count: attemptCount,
      p_external_customer_id: externalCustomerId,
    });
    requireFinalized("complete_accounting_customer", result);
  }

  async failCustomer(
    id: string,
    attemptCount: number,
    failure: PersistedFailure,
    externalCustomerId?: string,
  ): Promise<void> {
    const result = await this.client.rpc("fail_accounting_customer", {
      p_id: id,
      p_attempt_count: attemptCount,
      p_status: failure.status,
      p_retry_after: failure.retryAfter,
      p_last_error: failure.error,
      p_external_customer_id: externalCustomerId ?? null,
    });
    requireFinalized("fail_accounting_customer", result);
  }

  async claimDocument(input: ClaimDocumentInput): Promise<DocumentClaim> {
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
      p_stale_after_seconds: this.staleAfterSeconds,
    });
    const row = firstRow("claim_accounting_document", result);
    return {
      id: String(row.id),
      status: row.status as DocumentClaim["status"],
      externalDocumentId: row.external_document_id == null
        ? null
        : String(row.external_document_id),
      externalDocumentNumber: row.external_document_number == null
        ? null
        : String(row.external_document_number),
      documentUrl: row.document_url == null ? null : String(row.document_url),
      retryAfter: row.retry_after == null ? null : String(row.retry_after),
      claimed: Boolean(row.claimed),
      attemptCount: Number(row.attempt_count),
    };
  }

  async succeedDocument(
    id: string,
    attemptCount: number,
    document: RivhitDocumentResult,
  ): Promise<void> {
    const result = await this.client.rpc("complete_accounting_document", {
      p_id: id,
      p_attempt_count: attemptCount,
      p_external_document_id: document.documentId,
      p_external_document_number: document.documentNumber,
      p_document_url: document.documentUrl,
    });
    requireFinalized("complete_accounting_document", result);
  }

  async failDocument(
    id: string,
    attemptCount: number,
    failure: PersistedFailure,
    document?: RivhitDocumentResult,
  ): Promise<void> {
    const result = await this.client.rpc("fail_accounting_document", {
      p_id: id,
      p_attempt_count: attemptCount,
      p_status: failure.status,
      p_retry_after: failure.retryAfter,
      p_last_error: failure.error,
      p_external_document_id: document?.documentId ?? null,
      p_external_document_number: document?.documentNumber ?? null,
      p_document_url: document?.documentUrl ?? null,
    });
    requireFinalized("fail_accounting_document", result);
  }
}
