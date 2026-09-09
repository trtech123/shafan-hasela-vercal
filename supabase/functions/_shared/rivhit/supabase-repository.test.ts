import { describe, expect, test } from "vitest";
import {
  AccountingRepositoryIdempotencyError,
  SupabaseAccountingRepository,
} from "./supabase-repository.ts";
import type { PersistedFailure } from "./workflow.ts";

class RecordingSupabase {
  calls: unknown[] = [];
  rpcData: Record<string, unknown[]> = {
    claim_accounting_customer: [{
      id: "customer-row",
      status: "processing",
      external_customer_id: null,
      retry_after: null,
      claimed: true,
      attempt_count: 1,
    }],
    claim_accounting_document: [{
      id: "document-row",
      status: "processing",
      external_document_id: null,
      external_document_number: null,
      document_url: null,
      retry_after: null,
      claimed: true,
      attempt_count: 1,
    }],
  };

  async rpc(name: string, args: unknown) {
    this.calls.push({ kind: "rpc", name, args });
    if (name.startsWith("complete_") || name.startsWith("fail_")) {
      return { data: true, error: null };
    }
    return { data: this.rpcData[name], error: null };
  }

  from(table: string) {
    return {
      update: (payload: unknown) => ({
        eq: async (column: string, value: string) => {
          this.calls.push({ kind: "update", table, payload, column, value });
          return { error: null };
        },
      }),
    };
  }
}

const retryFailure: PersistedFailure = {
  status: "retryable_error",
  retryAfter: "2026-09-07T12:01:00.000Z",
  error: {
    message: "network",
    errorCode: null,
    httpStatus: null,
    clientMessage: null,
    debugMessage: null,
  },
};

describe("SupabaseAccountingRepository", () => {
  test("claims and normalizes customer/document rows through atomic RPCs", async () => {
    const client = new RecordingSupabase();
    const repository = new SupabaseAccountingRepository(client);

    await expect(repository.claimCustomer({
      provider: "rivhit",
      accountNamespace: "sandbox-account",
      identityKey: "identity",
      externalReference: "shreference",
    })).resolves.toEqual({
      id: "customer-row",
      status: "processing",
      externalCustomerId: null,
      retryAfter: null,
      claimed: true,
      attemptCount: 1,
    });
    await expect(repository.claimDocument({
      provider: "rivhit",
      accountNamespace: "sandbox-account",
      accountingCustomerId: "customer-row",
      sourceType: "order",
      sourceId: "source-id",
      documentTypeKey: "sandbox_test",
      externalDocumentType: 1,
      requestReference: "request-ref",
      payloadHash: "payload-hash",
    })).resolves.toMatchObject({ id: "document-row", claimed: true, attemptCount: 1 });

    expect(client.calls).toEqual([
      {
        kind: "rpc",
        name: "claim_accounting_customer",
        args: {
          p_provider: "rivhit",
          p_account_namespace: "sandbox-account",
          p_identity_key: "identity",
          p_external_reference: "shreference",
          p_stale_after_seconds: 300,
        },
      },
      {
        kind: "rpc",
        name: "claim_accounting_document",
        args: {
          p_provider: "rivhit",
          p_account_namespace: "sandbox-account",
          p_accounting_customer_id: "customer-row",
          p_source_type: "order",
          p_source_id: "source-id",
          p_document_type_key: "sandbox_test",
          p_external_document_type: 1,
          p_request_reference: "request-ref",
          p_payload_hash: "payload-hash",
          p_stale_after_seconds: 300,
        },
      },
    ]);
  });

  test("persists success and observable failure state", async () => {
    const client = new RecordingSupabase();
    const repository = new SupabaseAccountingRepository(client);

    await repository.succeedCustomer("customer-row", 1, "1234");
    await repository.failCustomer("customer-row", 1, retryFailure);
    await repository.succeedDocument("document-row", 1, {
      customerId: "1234",
      documentType: 1,
      documentId: "doc-id",
      documentNumber: "42",
      documentUrl: "https://api.rivhit.co.il/pdf/test",
      amount: 100,
    });
    await repository.failDocument("document-row", 1, retryFailure);

    expect(client.calls).toEqual([
      expect.objectContaining({
        kind: "rpc",
        name: "complete_accounting_customer",
        args: expect.objectContaining({
          p_attempt_count: 1,
          p_external_customer_id: "1234",
        }),
      }),
      expect.objectContaining({
        kind: "rpc",
        name: "fail_accounting_customer",
        args: expect.objectContaining({
          p_attempt_count: 1,
          p_status: "retryable_error",
          p_retry_after: retryFailure.retryAfter,
        }),
      }),
      expect.objectContaining({
        kind: "rpc",
        name: "complete_accounting_document",
        args: expect.objectContaining({
          p_attempt_count: 1,
          p_external_document_id: "doc-id",
          p_external_document_number: "42",
          p_document_url: "https://api.rivhit.co.il/pdf/test",
        }),
      }),
      expect.objectContaining({
        kind: "rpc",
        name: "fail_accounting_document",
        args: expect.objectContaining({
          p_attempt_count: 1,
          p_status: "retryable_error",
          p_retry_after: retryFailure.retryAfter,
        }),
      }),
    ]);
    expect(JSON.stringify(client.calls)).not.toContain("api_token");
  });

  test("surfaces Supabase RPC failures", async () => {
    const client = new RecordingSupabase();
    client.rpc = async () => ({ data: null, error: { message: "database unavailable" } });
    const repository = new SupabaseAccountingRepository(client);

    await expect(repository.claimCustomer({
      provider: "rivhit",
      accountNamespace: "sandbox-account",
      identityKey: "identity",
      externalReference: "reference",
    })).rejects.toThrow("claim_accounting_customer failed: database unavailable");
  });

  test("rejects stale finalization attempts", async () => {
    const client = new RecordingSupabase();
    client.rpc = async () => ({ data: false, error: null });
    const repository = new SupabaseAccountingRepository(client);

    await expect(repository.succeedCustomer("customer-row", 1, "1234"))
      .rejects.toThrow("stale accounting finalization");
  });

  test.each([
    ["customer", "accounting customer idempotency mismatch"],
    ["document", "database rejected: accounting document idempotency mismatch"],
  ] as const)("types a known %s idempotency mismatch for reconciliation", async (
    kind,
    message,
  ) => {
    const client = new RecordingSupabase();
    client.rpc = async () => ({ data: null, error: { message } });
    const repository = new SupabaseAccountingRepository(client);
    const operation = kind === "customer"
      ? repository.claimCustomer({
        provider: "rivhit",
        accountNamespace: "sandbox-account",
        identityKey: "identity",
        externalReference: "reference",
      })
      : repository.claimDocument({
        provider: "rivhit",
        accountNamespace: "sandbox-account",
        accountingCustomerId: "customer-row",
        sourceType: "payment_transaction",
        sourceId: "payment-row",
        documentTypeKey: "payment_success",
        externalDocumentType: 1,
        requestReference: "request-reference",
        payloadHash: "payload-hash",
      });

    await expect(operation).rejects.toMatchObject({
      name: "AccountingRepositoryIdempotencyError",
      kind,
    } satisfies Partial<AccountingRepositoryIdempotencyError>);
  });
});
