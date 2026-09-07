import { describe, expect, test } from "vitest";
import { SupabaseAccountingRepository } from "./supabase-repository.ts";
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

    await repository.succeedCustomer("customer-row", "1234");
    await repository.failCustomer("customer-row", retryFailure);
    await repository.succeedDocument("document-row", {
      customerId: "1234",
      documentType: 1,
      documentId: "doc-id",
      documentNumber: "42",
      documentUrl: "https://api.rivhit.co.il/pdf/test",
      amount: 100,
    });
    await repository.failDocument("document-row", retryFailure);

    expect(client.calls).toEqual([
      expect.objectContaining({
        kind: "update",
        table: "accounting_customers",
        payload: expect.objectContaining({
          status: "succeeded",
          external_customer_id: "1234",
          last_error: null,
        }),
      }),
      expect.objectContaining({
        kind: "update",
        table: "accounting_customers",
        payload: expect.objectContaining({
          status: "retryable_error",
          retry_after: retryFailure.retryAfter,
          last_error: retryFailure.error,
        }),
      }),
      expect.objectContaining({
        kind: "update",
        table: "accounting_documents",
        payload: expect.objectContaining({
          status: "succeeded",
          external_document_id: "doc-id",
          external_document_number: "42",
          document_url: "https://api.rivhit.co.il/pdf/test",
        }),
      }),
      expect.objectContaining({
        kind: "update",
        table: "accounting_documents",
        payload: expect.objectContaining({
          status: "retryable_error",
          retry_after: retryFailure.retryAfter,
          last_error: retryFailure.error,
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
      identityKey: "identity",
      externalReference: "reference",
    })).rejects.toThrow("claim_accounting_customer failed: database unavailable");
  });
});
