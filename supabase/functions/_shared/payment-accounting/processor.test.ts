import { describe, expect, test, vi } from "vitest";
import { RivhitError } from "../rivhit/client.ts";
import { AccountingRepositoryIdempotencyError } from "../rivhit/supabase-repository.ts";
import type {
  AccountingRepository,
  ClaimDocumentInput,
  CustomerClaim,
  DocumentClaim,
  PersistedFailure,
} from "../rivhit/workflow.ts";
import type {
  PaymentAccountingEventRepository,
} from "./repository.ts";
import {
  PaymentAccountingRepositoryError,
  PaymentAccountingSourceStateError,
} from "./repository.ts";
import type {
  AccountingEventClaim,
  AccountingEventFailure,
  AccountingEventFence,
  VerifiedPelecardPaymentSource,
} from "./types.ts";
import { processPaymentAccountingEvent } from "./processor.ts";

const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const paymentId = "22222222-2222-4222-8222-222222222222";
const leaseToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = new Date("2026-09-09T10:00:00.000Z");
const paymentSuccessMapping = {
  document_type: 1,
  sort_code: 100,
  currency_id: 1,
  currency_code: "ILS",
  price_include_vat: true,
  send_mail: false,
  digital_signature: false,
};

function eventClaim(overrides: Partial<AccountingEventClaim> = {}): AccountingEventClaim {
  return {
    id: eventId,
    sourceType: "payment_transaction",
    sourceId: paymentId,
    purpose: "payment_success",
    accountingProvider: "rivhit",
    status: "processing",
    claimed: true,
    attemptCount: 1,
    leaseToken,
    leaseExpiresAt: "2026-09-09T10:05:00.000Z",
    lastAttemptAt: now.toISOString(),
    nextAttemptAt: null,
    lastError: null,
    ...overrides,
  };
}

function verifiedPayment(
  overrides: Partial<VerifiedPelecardPaymentSource> & Record<string, unknown> = {},
): VerifiedPelecardPaymentSource & Record<string, unknown> {
  const orderId = "11111111-1111-4111-8111-111111111111";
  return {
    id: paymentId,
    provider: "pelecard",
    operation: "payment",
    status: "succeeded",
    orderId,
    saleId: "33333333-3333-4333-8333-333333333333",
    providerTransactionId: "provider-secret",
    amountMinor: 9001,
    currencyCode: "ILS",
    verifiedAt: now.toISOString(),
    checkoutItems: [{
      id: "activity",
      name: "Rope Course",
      quantity: 1,
      unitPriceMinor: 10000,
    }],
    order: {
      id: orderId,
      order_number: "ORD-1234",
      client_name: "Billing Customer",
      client_phone: "050-123-4567",
      client_email: "billing@example.com",
      num_participants: 1,
      price_per_person: 100,
      total_price: 100,
    },
    activityName: "Rope Course",
    ...overrides,
  };
}

class RecordingEventRepository implements PaymentAccountingEventRepository {
  claims: AccountingEventClaim[] = [eventClaim()];
  source: VerifiedPelecardPaymentSource = verifiedPayment();
  claimCalls: unknown[] = [];
  loadCalls: string[] = [];
  completions: AccountingEventFence[] = [];
  failures: Array<{ fence: AccountingEventFence; failure: AccountingEventFailure }> = [];

  async claimEvent(
    requestedEventId: string,
    workerId: string,
    leaseSeconds: number,
    forceRetry: boolean,
  ) {
    this.claimCalls.push({ requestedEventId, workerId, leaseSeconds, forceRetry });
    return this.claims.shift() ?? eventClaim({ claimed: false, status: "succeeded" });
  }

  async completeEvent(fence: AccountingEventFence) {
    this.completions.push(fence);
  }

  async failEvent(fence: AccountingEventFence, failure: AccountingEventFailure) {
    this.failures.push({ fence, failure });
  }

  async findEventIdForPayment() {
    return eventId;
  }

  async loadVerifiedPelecardPayment(sourceId: string) {
    this.loadCalls.push(sourceId);
    return this.source;
  }
}

class RecordingRivhitRepository implements AccountingRepository {
  customerClaim: CustomerClaim = {
    id: "customer-row",
    status: "succeeded",
    externalCustomerId: "1234",
    claimed: false,
    attemptCount: 1,
  };
  documentClaim: DocumentClaim = {
    id: "document-row",
    status: "processing",
    externalDocumentId: null,
    externalDocumentNumber: null,
    documentUrl: null,
    retryAfter: null,
    claimed: true,
    attemptCount: 1,
  };
  customerClaims = 0;
  documentClaims: ClaimDocumentInput[] = [];
  documentFailures: PersistedFailure[] = [];

  async claimCustomer() {
    this.customerClaims += 1;
    return this.customerClaim;
  }
  async succeedCustomer() {}
  async failCustomer() {}
  async claimDocument(input: ClaimDocumentInput) {
    this.documentClaims.push(input);
    return this.documentClaim;
  }
  async succeedDocument() {}
  async failDocument(
    _id: string,
    _attemptCount: number,
    failure: PersistedFailure,
  ) {
    this.documentFailures.push(failure);
  }
}

function successfulClient(overrides: Record<string, unknown> = {}) {
  return {
    findCustomerByAccRef: vi.fn(),
    createCustomer: vi.fn(),
    createDocument: vi.fn().mockResolvedValue({
      customerId: "1234",
      documentType: 1,
      documentId: "document-id",
      documentNumber: "42",
      documentUrl: "https://api.rivhit.co.il/pdf/test",
      amount: 90.01,
    }),
    ...overrides,
  };
}

function options(
  repository: RecordingEventRepository,
  rivhitRepository: RecordingRivhitRepository,
  rivhitClient = successfulClient(),
) {
  return {
    eventId,
    workerId: "accounting-worker-1",
    leaseSeconds: 180,
    forceRetry: false,
    repository,
    rivhitRepository,
    rivhitClient,
    documentMappings: { payment_success: paymentSuccessMapping },
    accountNamespace: "official-sandbox",
    now: () => now,
  };
}

describe("payment accounting event processor", () => {
  test("claims, runs Rivhit exactly once, and completes a successful event", async () => {
    const repository = new RecordingEventRepository();
    const rivhitRepository = new RecordingRivhitRepository();
    const client = successfulClient();

    const result = await processPaymentAccountingEvent(
      options(repository, rivhitRepository, client),
    );

    expect(result).toMatchObject({ status: "succeeded", claimed: true, duplicate: false });
    expect(repository.claimCalls).toEqual([{
      requestedEventId: eventId,
      workerId: "accounting-worker-1",
      leaseSeconds: 180,
      forceRetry: false,
    }]);
    expect(repository.loadCalls).toEqual([paymentId]);
    expect(rivhitRepository.customerClaims).toBe(1);
    expect(client.createDocument).toHaveBeenCalledOnce();
    expect(repository.completions).toEqual([{ id: eventId, attemptCount: 1, leaseToken }]);
    expect(repository.failures).toEqual([]);
  });

  test("no-ops safely when another worker already owns or finished the event", async () => {
    const repository = new RecordingEventRepository();
    repository.claims = [eventClaim({
      claimed: false,
      status: "succeeded",
      leaseToken: null,
      leaseExpiresAt: null,
    })];
    const rivhitRepository = new RecordingRivhitRepository();
    const client = successfulClient();

    await expect(processPaymentAccountingEvent(
      options(repository, rivhitRepository, client),
    )).resolves.toMatchObject({ status: "succeeded", claimed: false, duplicate: true });
    expect(repository.loadCalls).toEqual([]);
    expect(rivhitRepository.customerClaims).toBe(0);
    expect(client.createDocument).not.toHaveBeenCalled();
    expect(repository.completions).toEqual([]);
    expect(repository.failures).toEqual([]);
  });

  test("completes an idempotent duplicate Rivhit success", async () => {
    const repository = new RecordingEventRepository();
    const rivhitRepository = new RecordingRivhitRepository();
    rivhitRepository.documentClaim = {
      ...rivhitRepository.documentClaim,
      status: "succeeded",
      claimed: false,
      externalDocumentId: "existing-id",
      externalDocumentNumber: "41",
      documentUrl: "https://api.rivhit.co.il/pdf/existing",
    };
    const client = successfulClient();

    await expect(processPaymentAccountingEvent(
      options(repository, rivhitRepository, client),
    )).resolves.toMatchObject({ status: "succeeded", duplicate: true });
    expect(client.createDocument).not.toHaveBeenCalled();
    expect(repository.completions).toHaveLength(1);
  });

  test.each([
    [
      "retryable_error",
      new RivhitError("secret-network-detail", { retryable: true, httpStatus: 503 }),
      "2026-09-09T10:01:00.000Z",
    ],
    ["permanent_error", new RivhitError("invalid request", { errorCode: -28 }), null],
    [
      "reconciliation_required",
      new RivhitError("ambiguous duplicate", { errorCode: -107, reconciliationRequired: true }),
      null,
    ],
  ] as const)("classifies a Rivhit %s without reversing payment", async (status, error, retryAt) => {
    const repository = new RecordingEventRepository();
    const originalPayment = verifiedPayment({
      rawCallbackBody: "do-not-persist-callback-secret",
    });
    repository.source = originalPayment;
    const before = structuredClone(originalPayment);
    const rivhitRepository = new RecordingRivhitRepository();
    const client = successfulClient({ createDocument: vi.fn().mockRejectedValue(error) });

    const result = await processPaymentAccountingEvent(
      options(repository, rivhitRepository, client),
    );

    expect(result).toMatchObject({ status, claimed: true });
    expect(repository.source).toEqual(before);
    expect(repository.completions).toEqual([]);
    expect(repository.failures[0]).toMatchObject({
      fence: { id: eventId, attemptCount: 1, leaseToken },
      failure: { status, nextAttemptAt: retryAt },
    });
    expect(JSON.stringify(repository.failures)).not.toContain("secret-network-detail");
    expect(JSON.stringify(repository.failures)).not.toContain("do-not-persist-callback-secret");
    expect(JSON.stringify(client.createDocument.mock.calls)).not.toContain(
      "do-not-persist-callback-secret",
    );
  });

  test.each([
    ["missing mapping", {}, "official-sandbox"],
    ["missing currency", { payment_success: { ...paymentSuccessMapping, currency_code: undefined } }, "official-sandbox"],
    ["currency mismatch", { payment_success: { ...paymentSuccessMapping, currency_code: "USD" } }, "official-sandbox"],
    ["missing namespace", { payment_success: paymentSuccessMapping }, ""],
  ])("marks %s as configuration_required before Rivhit", async (
    _label,
    documentMappings,
    accountNamespace,
  ) => {
    const repository = new RecordingEventRepository();
    const rivhitRepository = new RecordingRivhitRepository();
    const client = successfulClient();

    const result = await processPaymentAccountingEvent({
      ...options(repository, rivhitRepository, client),
      documentMappings,
      accountNamespace,
    });

    expect(result.status).toBe("configuration_required");
    expect(rivhitRepository.customerClaims).toBe(0);
    expect(client.createDocument).not.toHaveBeenCalled();
    expect(repository.failures[0].failure).toMatchObject({
      status: "configuration_required",
      nextAttemptAt: null,
    });
  });

  test("marks unlinked payment and missing billing identity for reconciliation", async () => {
    for (const source of [
      verifiedPayment({ orderId: null, order: null }),
      verifiedPayment({
        order: {
          ...verifiedPayment().order!,
          client_name: "",
          organization: null,
          billing_institution_name: null,
        },
      }),
    ]) {
      const repository = new RecordingEventRepository();
      repository.source = source;
      const rivhitRepository = new RecordingRivhitRepository();
      const client = successfulClient();

      const result = await processPaymentAccountingEvent(
        options(repository, rivhitRepository, client),
      );

      expect(result.status).toBe("reconciliation_required");
      expect(rivhitRepository.customerClaims).toBe(0);
      expect(client.createDocument).not.toHaveBeenCalled();
    }
  });

  test.each([
    ["wrong_provider", "permanent_error"],
    ["payment_not_verified", "reconciliation_required"],
  ] as const)("mirrors typed source-state %s", async (code, status) => {
    const repository = new RecordingEventRepository();
    repository.loadVerifiedPelecardPayment = async () => {
      throw new PaymentAccountingSourceStateError(code, status);
    };
    const rivhitRepository = new RecordingRivhitRepository();

    const result = await processPaymentAccountingEvent(
      options(repository, rivhitRepository),
    );

    expect(result.status).toBe(status);
    expect(repository.failures[0].failure.status).toBe(status);
    expect(rivhitRepository.customerClaims).toBe(0);
  });

  test("marks repository/infrastructure loading failures as retryable", async () => {
    const repository = new RecordingEventRepository();
    repository.loadVerifiedPelecardPayment = async () => {
      throw new PaymentAccountingRepositoryError(
        "database_error",
        "load_payment_transactions",
      );
    };
    const rivhitRepository = new RecordingRivhitRepository();

    const result = await processPaymentAccountingEvent(
      options(repository, rivhitRepository),
    );

    expect(result).toMatchObject({
      status: "retryable_error",
      retryAfter: "2026-09-09T10:01:00.000Z",
    });
    expect(repository.failures[0].failure.error).toMatchObject({
      code: "database_error",
    });
    expect(rivhitRepository.customerClaims).toBe(0);
  });

  test("marks a Rivhit ledger idempotency mismatch for reconciliation", async () => {
    const repository = new RecordingEventRepository();
    const rivhitRepository = new RecordingRivhitRepository();
    rivhitRepository.claimDocument = async () => {
      throw new AccountingRepositoryIdempotencyError("document");
    };

    const result = await processPaymentAccountingEvent(
      options(repository, rivhitRepository),
    );

    expect(result.status).toBe("reconciliation_required");
    expect(repository.failures[0].failure).toMatchObject({
      status: "reconciliation_required",
      nextAttemptAt: null,
      error: { code: "rivhit_document_idempotency_mismatch" },
    });
  });

  test("treats inner processing state as retryable with bounded backoff", async () => {
    const repository = new RecordingEventRepository();
    repository.claims = [eventClaim({ attemptCount: 99 })];
    const rivhitRepository = new RecordingRivhitRepository();
    rivhitRepository.documentClaim = {
      ...rivhitRepository.documentClaim,
      status: "processing",
      claimed: false,
    };

    const result = await processPaymentAccountingEvent(
      options(repository, rivhitRepository),
    );

    expect(result.status).toBe("retryable_error");
    expect(repository.failures[0].failure.nextAttemptAt)
      .toBe("2026-09-09T11:00:00.000Z");
  });

  test("uses stable Rivhit idempotency inputs across a retry", async () => {
    const repository = new RecordingEventRepository();
    repository.claims = [
      eventClaim({ attemptCount: 1 }),
      eventClaim({ attemptCount: 2, leaseToken: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
    ];
    const rivhitRepository = new RecordingRivhitRepository();
    const transient = new RivhitError("network", { retryable: true });
    const client = successfulClient({
      createDocument: vi.fn()
        .mockRejectedValueOnce(transient)
        .mockResolvedValueOnce({
          customerId: "1234",
          documentType: 1,
          documentId: "document-id",
          documentNumber: "42",
          documentUrl: "https://api.rivhit.co.il/pdf/test",
          amount: 90.01,
        }),
    });
    const input = options(repository, rivhitRepository, client);

    await processPaymentAccountingEvent(input);
    await processPaymentAccountingEvent({ ...input, forceRetry: true });

    expect(rivhitRepository.documentClaims).toHaveLength(2);
    expect(rivhitRepository.documentClaims[1]).toEqual(rivhitRepository.documentClaims[0]);
    expect(repository.failures).toHaveLength(1);
    expect(repository.completions).toEqual([{
      id: eventId,
      attemptCount: 2,
      leaseToken: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }]);
  });

  test("rejects unexpected claimed event metadata without invoking Rivhit", async () => {
    const repository = new RecordingEventRepository();
    repository.claims = [eventClaim({ purpose: "club_recurring_success" })];
    const rivhitRepository = new RecordingRivhitRepository();

    const result = await processPaymentAccountingEvent(
      options(repository, rivhitRepository),
    );

    expect(result.status).toBe("permanent_error");
    expect(repository.loadCalls).toEqual([]);
    expect(rivhitRepository.customerClaims).toBe(0);
  });

  test("rejects a claim for another event without touching either event or Rivhit", async () => {
    const repository = new RecordingEventRepository();
    repository.claims = [eventClaim({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    })];
    const rivhitRepository = new RecordingRivhitRepository();

    await expect(processPaymentAccountingEvent(
      options(repository, rivhitRepository),
    )).rejects.toMatchObject({
      name: "PaymentAccountingRepositoryError",
      code: "malformed_response",
    });
    expect(repository.loadCalls).toEqual([]);
    expect(repository.completions).toEqual([]);
    expect(repository.failures).toEqual([]);
    expect(rivhitRepository.customerClaims).toBe(0);
  });

  test("preserves a later valid inner-ledger retry timestamp", async () => {
    const repository = new RecordingEventRepository();
    const rivhitRepository = new RecordingRivhitRepository();
    rivhitRepository.documentClaim = {
      ...rivhitRepository.documentClaim,
      status: "retryable_error",
      claimed: false,
      retryAfter: "2026-09-09T10:10:00.000Z",
    };

    const result = await processPaymentAccountingEvent(
      options(repository, rivhitRepository),
    );

    expect(result).toMatchObject({
      status: "retryable_error",
      retryAfter: "2026-09-09T10:10:00.000Z",
    });
    expect(repository.failures[0].failure.nextAttemptAt)
      .toBe("2026-09-09T10:10:00.000Z");
  });

  test.each([
    "not-a-date",
    "2026-09-09T09:59:00.000Z",
  ])("falls back to bounded outer backoff for invalid inner retry %s", async (retryAfter) => {
    const repository = new RecordingEventRepository();
    const rivhitRepository = new RecordingRivhitRepository();
    rivhitRepository.documentClaim = {
      ...rivhitRepository.documentClaim,
      status: "retryable_error",
      claimed: false,
      retryAfter,
    };

    const result = await processPaymentAccountingEvent(
      options(repository, rivhitRepository),
    );

    expect(result.retryAfter).toBe("2026-09-09T10:01:00.000Z");
    expect(repository.failures[0].failure.nextAttemptAt)
      .toBe("2026-09-09T10:01:00.000Z");
  });

  test("does not overwrite a newer event attempt when completion loses its fence", async () => {
    const repository = new RecordingEventRepository();
    repository.completeEvent = async () => {
      throw new PaymentAccountingRepositoryError(
        "stale_event_fence",
        "complete_accounting_event",
      );
    };
    const rivhitRepository = new RecordingRivhitRepository();

    await expect(processPaymentAccountingEvent(
      options(repository, rivhitRepository),
    )).rejects.toMatchObject({ code: "stale_event_fence" });
    expect(repository.failures).toEqual([]);
  });
});
