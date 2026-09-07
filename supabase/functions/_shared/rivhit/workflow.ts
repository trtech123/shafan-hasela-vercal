import { RivhitError } from "./client.ts";
import type {
  AccountingStatus,
  MappedAccountingSource,
  RivhitCustomerDraft,
  RivhitCustomerResult,
  RivhitDocumentResult,
} from "./types.ts";

export interface ClaimCustomerInput {
  provider: string;
  identityKey: string;
  externalReference: string;
}

export interface CustomerClaim {
  id: string;
  status: AccountingStatus;
  externalCustomerId: string | null;
  retryAfter?: string | null;
  claimed: boolean;
  attemptCount: number;
}

export interface ClaimDocumentInput {
  provider: string;
  accountingCustomerId: string;
  sourceType: string;
  sourceId: string;
  documentTypeKey: string;
  externalDocumentType: number;
  requestReference: string;
  payloadHash: string;
}

export interface DocumentClaim {
  id: string;
  status: AccountingStatus;
  externalDocumentId: string | null;
  externalDocumentNumber: string | null;
  documentUrl: string | null;
  retryAfter: string | null;
  claimed: boolean;
  attemptCount: number;
}

export interface PersistedError {
  message: string;
  errorCode: number | null;
  httpStatus: number | null;
  clientMessage: string | null;
  debugMessage: string | null;
}

export interface PersistedFailure {
  status: "retryable_error" | "permanent_error" | "reconciliation_required";
  retryAfter: string | null;
  error: PersistedError;
}

export interface AccountingRepository {
  claimCustomer(input: ClaimCustomerInput): Promise<CustomerClaim>;
  succeedCustomer(id: string, externalCustomerId: string): Promise<void>;
  failCustomer(id: string, failure: PersistedFailure): Promise<void>;
  claimDocument(input: ClaimDocumentInput): Promise<DocumentClaim>;
  succeedDocument(id: string, result: RivhitDocumentResult): Promise<void>;
  failDocument(id: string, failure: PersistedFailure): Promise<void>;
}

export interface RivhitAccountingClient {
  findCustomerByAccRef(accRef: string): Promise<RivhitCustomerResult | null>;
  createCustomer(request: RivhitCustomerDraft): Promise<RivhitCustomerResult>;
  createDocument(request: Record<string, unknown>): Promise<RivhitDocumentResult>;
}

export type WorkflowResult =
  | {
    status: "succeeded";
    duplicate: boolean;
    customerId: string;
    documentId: string;
    documentNumber: string;
    documentUrl: string;
  }
  | {
    status: Exclude<AccountingStatus, "succeeded">;
    duplicate: true;
    retryAfter: string | null;
  };

function persistedError(error: unknown): PersistedError {
  if (error instanceof RivhitError) {
    return {
      message: error.message,
      errorCode: error.errorCode,
      httpStatus: error.httpStatus,
      clientMessage: error.clientMessage,
      debugMessage: error.debugMessage,
    };
  }
  return {
    message: error instanceof Error ? error.message : "Unknown accounting error",
    errorCode: null,
    httpStatus: null,
    clientMessage: null,
    debugMessage: null,
  };
}

function failureFor(error: unknown, attemptCount: number, now: Date): PersistedFailure {
  const rivhitError = error instanceof RivhitError ? error : null;
  const status = rivhitError?.reconciliationRequired
    ? "reconciliation_required"
    : rivhitError?.retryable
      ? "retryable_error"
      : "permanent_error";
  const delaySeconds = Math.min(3600, 60 * (2 ** Math.max(0, attemptCount - 1)));
  const retryAfter = status === "retryable_error"
    ? new Date(now.getTime() + delaySeconds * 1000).toISOString()
    : null;
  return { status, retryAfter, error: persistedError(error) };
}

function unclaimedResult(
  status: Exclude<AccountingStatus, "succeeded">,
  retryAfter: string | null | undefined,
): WorkflowResult {
  return { status, duplicate: true, retryAfter: retryAfter ?? null };
}

interface RunOptions {
  source: MappedAccountingSource;
  repository: AccountingRepository;
  client: RivhitAccountingClient;
  now?: () => Date;
}

export async function runRivhitAccounting(options: RunOptions): Promise<WorkflowResult> {
  const { source, repository, client } = options;
  const now = options.now ?? (() => new Date());

  const customerClaim = await repository.claimCustomer({
    provider: source.provider,
    identityKey: source.identityKey,
    externalReference: source.externalCustomerReference,
  });

  let externalCustomerId = customerClaim.externalCustomerId;
  if (!customerClaim.claimed) {
    if (customerClaim.status !== "succeeded" || !externalCustomerId) {
      return unclaimedResult(
        customerClaim.status as Exclude<AccountingStatus, "succeeded">,
        customerClaim.retryAfter,
      );
    }
  } else {
    try {
      const found = await client.findCustomerByAccRef(source.externalCustomerReference);
      const customer = found ?? await client.createCustomer(source.customer);
      externalCustomerId = customer.customerId;
      await repository.succeedCustomer(customerClaim.id, externalCustomerId);
    } catch (error) {
      await repository.failCustomer(
        customerClaim.id,
        failureFor(error, customerClaim.attemptCount, now()),
      );
      throw error;
    }
  }

  if (!externalCustomerId) {
    throw new Error("Accounting customer succeeded without an external customer ID");
  }

  const documentClaim = await repository.claimDocument({
    provider: source.provider,
    accountingCustomerId: customerClaim.id,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    documentTypeKey: source.documentTypeKey,
    externalDocumentType: source.document.document_type,
    requestReference: source.documentRequestReference,
    payloadHash: source.payloadHash,
  });

  if (!documentClaim.claimed) {
    if (
      documentClaim.status === "succeeded"
      && documentClaim.externalDocumentId
      && documentClaim.externalDocumentNumber
      && documentClaim.documentUrl
    ) {
      return {
        status: "succeeded",
        duplicate: true,
        customerId: externalCustomerId,
        documentId: documentClaim.externalDocumentId,
        documentNumber: documentClaim.externalDocumentNumber,
        documentUrl: documentClaim.documentUrl,
      };
    }
    return unclaimedResult(
      documentClaim.status as Exclude<AccountingStatus, "succeeded">,
      documentClaim.retryAfter,
    );
  }

  try {
    const result = await client.createDocument({
      ...source.document,
      customer_id: Number(externalCustomerId),
    });
    await repository.succeedDocument(documentClaim.id, result);
    return {
      status: "succeeded",
      duplicate: false,
      customerId: result.customerId,
      documentId: result.documentId,
      documentNumber: result.documentNumber,
      documentUrl: result.documentUrl,
    };
  } catch (error) {
    await repository.failDocument(
      documentClaim.id,
      failureFor(error, documentClaim.attemptCount, now()),
    );
    throw error;
  }
}
