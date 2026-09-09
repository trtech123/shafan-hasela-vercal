import { RivhitError } from "../rivhit/client.ts";
import { getDocumentMapping } from "../rivhit/config.ts";
import type { DocumentMapping } from "../rivhit/types.ts";
import {
  runRivhitAccounting,
  type AccountingRepository,
  type RivhitAccountingClient,
  type WorkflowResult,
} from "../rivhit/workflow.ts";
import {
  mapVerifiedPaymentToAccountingSource,
  PaymentAccountingConfigurationError,
  PaymentAccountingReconciliationError,
} from "./payment-mapper.ts";
import {
  type PaymentAccountingEventRepository,
  PaymentAccountingRepositoryError,
  PaymentAccountingSourceStateError,
} from "./repository.ts";
import type {
  AccountingEventClaim,
  AccountingEventFailure,
  AccountingEventFailureStatus,
  AccountingEventFence,
  AccountingEventStatus,
} from "./types.ts";

export interface ProcessPaymentAccountingEventOptions {
  eventId: string;
  workerId: string;
  leaseSeconds?: number;
  forceRetry?: boolean;
  repository: PaymentAccountingEventRepository;
  rivhitRepository: AccountingRepository;
  rivhitClient: RivhitAccountingClient;
  documentMappings: Record<string, DocumentMapping>;
  accountNamespace: string;
  now?: () => Date;
}

export interface PaymentAccountingEventResult {
  eventId: string;
  status: AccountingEventStatus | null;
  claimed: boolean;
  duplicate: boolean;
  retryAfter: string | null;
  documentId?: string;
  documentNumber?: string;
  documentUrl?: string;
}

class ProcessorConfigurationError extends Error {
  readonly code: "missing_document_mapping" | "missing_account_namespace";

  constructor(code: ProcessorConfigurationError["code"]) {
    super(code);
    this.name = "ProcessorConfigurationError";
    this.code = code;
  }
}

class InvalidAccountingEventSourceError extends Error {
  readonly code = "invalid_accounting_event_source";
}

function eventFence(claim: AccountingEventClaim): AccountingEventFence {
  if (
    claim.attemptCount === null
    || claim.attemptCount < 1
    || !claim.leaseToken
  ) {
    throw new PaymentAccountingRepositoryError(
      "malformed_response",
      "claim_accounting_event",
    );
  }
  return {
    id: claim.id,
    attemptCount: claim.attemptCount,
    leaseToken: claim.leaseToken,
  };
}

function retryAt(attemptCount: number, now: Date): string {
  const exponent = Math.min(6, Math.max(0, attemptCount - 1));
  const delaySeconds = Math.min(3600, 60 * (2 ** exponent));
  return new Date(now.getTime() + delaySeconds * 1000).toISOString();
}

function controlledError(
  status: AccountingEventFailureStatus,
  code: string,
  error?: RivhitError,
): AccountingEventFailure["error"] {
  return {
    code,
    message: status === "configuration_required"
      ? "Accounting configuration is incomplete"
      : status === "reconciliation_required"
        ? "Accounting requires manual reconciliation"
        : status === "retryable_error"
          ? "Accounting operation can be retried"
          : "Accounting source or request is invalid",
    ...(error
      ? {
        errorCode: error.errorCode,
        httpStatus: error.httpStatus,
        retryable: error.retryable,
        reconciliationRequired: error.reconciliationRequired,
      }
      : {}),
  };
}

function classifiedFailure(
  error: unknown,
  attemptCount: number,
  now: Date,
): AccountingEventFailure {
  let status: AccountingEventFailureStatus;
  let code: string;
  let rivhitError: RivhitError | undefined;

  if (
    error instanceof ProcessorConfigurationError
    || error instanceof PaymentAccountingConfigurationError
  ) {
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
  } else if (error instanceof RivhitError) {
    rivhitError = error;
    status = error.reconciliationRequired
      ? "reconciliation_required"
      : error.retryable
        ? "retryable_error"
        : "permanent_error";
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
    nextAttemptAt: status === "retryable_error"
      ? retryAt(attemptCount, now)
      : null,
    error: controlledError(status, code, rivhitError),
  };
}

function workflowFailure(
  result: Exclude<WorkflowResult, { status: "succeeded" }>,
  attemptCount: number,
  now: Date,
): AccountingEventFailure {
  const status: AccountingEventFailureStatus =
    result.status === "permanent_error"
      ? "permanent_error"
      : result.status === "reconciliation_required"
        ? "reconciliation_required"
        : "retryable_error";
  return {
    status,
    nextAttemptAt: status === "retryable_error"
      ? retryAt(attemptCount, now)
      : null,
    error: controlledError(status, `rivhit_workflow_${result.status}`),
  };
}

function validateClaimedSource(claim: AccountingEventClaim): string {
  if (
    claim.sourceType !== "payment_transaction"
    || claim.purpose !== "payment_success"
    || claim.accountingProvider !== "rivhit"
    || !claim.sourceId
  ) {
    throw new InvalidAccountingEventSourceError();
  }
  return claim.sourceId;
}

export async function processPaymentAccountingEvent(
  options: ProcessPaymentAccountingEventOptions,
): Promise<PaymentAccountingEventResult> {
  const claim = await options.repository.claimEvent(
    options.eventId,
    options.workerId,
    options.leaseSeconds ?? 300,
    options.forceRetry ?? false,
  );
  if (!claim.claimed) {
    return {
      eventId: claim.id,
      status: claim.status,
      claimed: false,
      duplicate: true,
      retryAfter: claim.nextAttemptAt,
    };
  }

  const fence = eventFence(claim);
  let workflowResult: WorkflowResult;
  try {
    const sourceId = validateClaimedSource(claim);
    if (!options.accountNamespace.trim()) {
      throw new ProcessorConfigurationError("missing_account_namespace");
    }
    let mapping: DocumentMapping;
    try {
      mapping = getDocumentMapping(options.documentMappings, "payment_success");
    } catch {
      throw new ProcessorConfigurationError("missing_document_mapping");
    }
    const payment = await options.repository.loadVerifiedPelecardPayment(sourceId);
    const source = await mapVerifiedPaymentToAccountingSource(
      payment,
      mapping,
      options.accountNamespace,
    );
    workflowResult = await runRivhitAccounting({
      source,
      repository: options.rivhitRepository,
      client: options.rivhitClient,
      now: options.now,
    });
  } catch (error) {
    const failure = classifiedFailure(
      error,
      fence.attemptCount,
      (options.now ?? (() => new Date()))(),
    );
    await options.repository.failEvent(fence, failure);
    return {
      eventId: claim.id,
      status: failure.status,
      claimed: true,
      duplicate: false,
      retryAfter: failure.nextAttemptAt,
    };
  }

  if (workflowResult.status !== "succeeded") {
    const failure = workflowFailure(
      workflowResult,
      fence.attemptCount,
      (options.now ?? (() => new Date()))(),
    );
    await options.repository.failEvent(fence, failure);
    return {
      eventId: claim.id,
      status: failure.status,
      claimed: true,
      duplicate: true,
      retryAfter: failure.nextAttemptAt,
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
    documentUrl: workflowResult.documentUrl,
  };
}
