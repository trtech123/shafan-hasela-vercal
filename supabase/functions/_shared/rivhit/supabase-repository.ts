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
  rpc(name: string, args: Record<string, unknown>): Promise<SupabaseResult<unknown[]>>;
  from(table: string): {
    update(payload: Record<string, unknown>): {
      eq(column: string, value: string): Promise<SupabaseResult>;
    };
  };
}

function failureMessage(operation: string, error: { message?: string } | null | undefined): Error {
  return new Error(`${operation} failed: ${error?.message || "unknown Supabase error"}`);
}

function firstRow(operation: string, result: SupabaseResult<unknown[]>): Record<string, unknown> {
  if (result.error) throw failureMessage(operation, result.error);
  if (!Array.isArray(result.data) || !result.data[0]) {
    throw new Error(`${operation} failed: no claim row returned`);
  }
  return result.data[0] as Record<string, unknown>;
}

export class SupabaseAccountingRepository implements AccountingRepository {
  constructor(
    private readonly client: SupabaseClientLike,
    private readonly staleAfterSeconds = 300,
  ) {}

  async claimCustomer(input: ClaimCustomerInput): Promise<CustomerClaim> {
    const result = await this.client.rpc("claim_accounting_customer", {
      p_provider: input.provider,
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

  async succeedCustomer(id: string, externalCustomerId: string): Promise<void> {
    await this.update("accounting_customers", id, {
      status: "succeeded",
      external_customer_id: externalCustomerId,
      retry_after: null,
      last_error: null,
    });
  }

  async failCustomer(id: string, failure: PersistedFailure): Promise<void> {
    await this.update("accounting_customers", id, {
      status: failure.status,
      retry_after: failure.retryAfter,
      last_error: failure.error,
    });
  }

  async claimDocument(input: ClaimDocumentInput): Promise<DocumentClaim> {
    const result = await this.client.rpc("claim_accounting_document", {
      p_provider: input.provider,
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

  async succeedDocument(id: string, result: RivhitDocumentResult): Promise<void> {
    await this.update("accounting_documents", id, {
      status: "succeeded",
      external_document_id: result.documentId,
      external_document_number: result.documentNumber,
      document_url: result.documentUrl,
      retry_after: null,
      last_error: null,
    });
  }

  async failDocument(id: string, failure: PersistedFailure): Promise<void> {
    await this.update("accounting_documents", id, {
      status: failure.status,
      retry_after: failure.retryAfter,
      last_error: failure.error,
    });
  }

  private async update(
    table: string,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.client.from(table).update(payload).eq("id", id);
    if (result.error) throw failureMessage(`${table} update`, result.error);
  }
}
