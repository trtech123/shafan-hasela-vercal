import { describe, expect, test, vi } from "vitest";
import { RivhitError } from "./client.ts";
import { mapOrderToAccountingSource } from "./order-mapper.ts";
import type {
  AccountingRepository,
  CustomerClaim,
  DocumentClaim,
  PersistedFailure,
} from "./workflow.ts";
import { runRivhitAccounting } from "./workflow.ts";

const now = new Date("2026-09-07T12:00:00.000Z");
const mapping = {
  document_type: 1,
  sort_code: 100,
  currency_id: 1,
  price_include_vat: true,
  send_mail: false,
  digital_signature: false,
};

async function mappedSource() {
  return mapOrderToAccountingSource({
    id: "11111111-1111-4111-8111-111111111111",
    order_number: "ORD-1234",
    client_name: "Sandbox Customer",
    client_phone: "050-123-4567",
    num_participants: 2,
    price_per_person: 50,
    total_price: 100,
  }, "Sandbox Activity", "sandbox_test", mapping);
}

class RecordingRepository implements AccountingRepository {
  customerClaim: CustomerClaim = {
    id: "customer-row",
    status: "processing",
    externalCustomerId: null,
    claimed: true,
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
  customerSuccesses: unknown[] = [];
  customerFailures: PersistedFailure[] = [];
  documentSuccesses: unknown[] = [];
  documentFailures: PersistedFailure[] = [];

  async claimCustomer() { return this.customerClaim; }
  async succeedCustomer(id: string, externalCustomerId: string) {
    this.customerSuccesses.push({ id, externalCustomerId });
  }
  async failCustomer(_id: string, failure: PersistedFailure) {
    this.customerFailures.push(failure);
  }
  async claimDocument() { return this.documentClaim; }
  async succeedDocument(id: string, result: unknown) {
    this.documentSuccesses.push({ id, result });
  }
  async failDocument(_id: string, failure: PersistedFailure) {
    this.documentFailures.push(failure);
  }
}

function successfulClient(overrides: Record<string, unknown> = {}) {
  return {
    findCustomerByAccRef: vi.fn().mockResolvedValue({ customerId: "1234" }),
    createCustomer: vi.fn().mockResolvedValue({ customerId: "1234" }),
    createDocument: vi.fn().mockResolvedValue({
      customerId: "1234",
      documentType: 1,
      documentId: "document-identity",
      documentNumber: "42",
      documentUrl: "https://api.rivhit.co.il/pdf/test",
      amount: 100,
    }),
    ...overrides,
  };
}

describe("Rivhit accounting workflow", () => {
  test("finds an existing customer and persists the created document", async () => {
    const repository = new RecordingRepository();
    const client = successfulClient();

    const result = await runRivhitAccounting({
      source: await mappedSource(), repository, client, now: () => now,
    });

    expect(client.findCustomerByAccRef).toHaveBeenCalledOnce();
    expect(client.createCustomer).not.toHaveBeenCalled();
    expect(repository.customerSuccesses).toEqual([
      { id: "customer-row", externalCustomerId: "1234" },
    ]);
    expect(client.createDocument).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: 1234,
      request_reference: expect.stringContaining("sandbox_test"),
      prevent_duplicates: true,
    }));
    expect(repository.documentSuccesses).toHaveLength(1);
    expect(result).toMatchObject({
      status: "succeeded",
      duplicate: false,
      customerId: "1234",
      documentId: "document-identity",
      documentNumber: "42",
      documentUrl: "https://api.rivhit.co.il/pdf/test",
    });
  });

  test("creates and persists a missing customer", async () => {
    const repository = new RecordingRepository();
    const client = successfulClient({
      findCustomerByAccRef: vi.fn().mockResolvedValue(null),
    });

    await runRivhitAccounting({
      source: await mappedSource(), repository, client, now: () => now,
    });

    expect(client.createCustomer).toHaveBeenCalledOnce();
    expect(repository.customerSuccesses).toEqual([
      { id: "customer-row", externalCustomerId: "1234" },
    ]);
  });

  test("returns persisted success without a duplicate Rivhit request", async () => {
    const repository = new RecordingRepository();
    repository.customerClaim = {
      ...repository.customerClaim,
      status: "succeeded",
      externalCustomerId: "1234",
      claimed: false,
    };
    repository.documentClaim = {
      ...repository.documentClaim,
      status: "succeeded",
      externalDocumentId: "persisted-id",
      externalDocumentNumber: "41",
      documentUrl: "https://api.rivhit.co.il/pdf/persisted",
      claimed: false,
    };
    const client = successfulClient();

    const result = await runRivhitAccounting({
      source: await mappedSource(), repository, client, now: () => now,
    });

    expect(client.findCustomerByAccRef).not.toHaveBeenCalled();
    expect(client.createDocument).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "succeeded",
      duplicate: true,
      documentId: "persisted-id",
      documentNumber: "41",
    });
  });

  test("does not retry processing or not-yet-due document work", async () => {
    for (const documentClaim of [
      { status: "processing", retryAfter: null },
      { status: "retryable_error", retryAfter: "2026-09-07T12:01:00.000Z" },
    ]) {
      const repository = new RecordingRepository();
      repository.customerClaim = {
        ...repository.customerClaim,
        status: "succeeded",
        externalCustomerId: "1234",
        claimed: false,
      };
      repository.documentClaim = {
        ...repository.documentClaim,
        ...documentClaim,
        claimed: false,
      } as DocumentClaim;
      const client = successfulClient();

      const result = await runRivhitAccounting({
        source: await mappedSource(), repository, client, now: () => now,
      });

      expect(client.createDocument).not.toHaveBeenCalled();
      expect(result.status).toBe(documentClaim.status);
    }
  });

  test("persists retry metadata and succeeds when a later claim is granted", async () => {
    const repository = new RecordingRepository();
    repository.customerClaim = {
      ...repository.customerClaim,
      status: "succeeded",
      externalCustomerId: "1234",
      claimed: false,
    };
    repository.documentClaim = { ...repository.documentClaim, attemptCount: 2 };
    const networkError = new RivhitError("Rivhit network request failed", { retryable: true });
    const client = successfulClient({
      createDocument: vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          customerId: "1234",
          documentType: 1,
          documentId: "retried-id",
          documentNumber: "43",
          documentUrl: "https://api.rivhit.co.il/pdf/retried",
          amount: 100,
        }),
    });

    await expect(runRivhitAccounting({
      source: await mappedSource(), repository, client, now: () => now,
    })).rejects.toBe(networkError);
    expect(repository.documentFailures).toEqual([
      expect.objectContaining({
        status: "retryable_error",
        retryAfter: "2026-09-07T12:02:00.000Z",
      }),
    ]);

    await expect(runRivhitAccounting({
      source: await mappedSource(), repository, client, now: () => new Date("2026-09-07T12:02:01.000Z"),
    })).resolves.toMatchObject({ status: "succeeded", documentId: "retried-id" });
  });

  test("persists permanent and reconciliation-required API errors", async () => {
    for (const error of [
      new RivhitError("invalid", { errorCode: -28 }),
      new RivhitError("duplicate", { errorCode: -107, reconciliationRequired: true }),
    ]) {
      const repository = new RecordingRepository();
      repository.customerClaim = {
        ...repository.customerClaim,
        status: "succeeded",
        externalCustomerId: "1234",
        claimed: false,
      };
      const client = successfulClient({ createDocument: vi.fn().mockRejectedValue(error) });

      await expect(runRivhitAccounting({
        source: await mappedSource(), repository, client, now: () => now,
      })).rejects.toBe(error);

      expect(repository.documentFailures[0].status).toBe(
        error.reconciliationRequired ? "reconciliation_required" : "permanent_error",
      );
      expect(repository.documentFailures[0].error).toMatchObject({ errorCode: error.errorCode });
    }
  });

  test("persists customer lookup network failures", async () => {
    const repository = new RecordingRepository();
    const error = new RivhitError("network", { retryable: true });
    const client = successfulClient({ findCustomerByAccRef: vi.fn().mockRejectedValue(error) });

    await expect(runRivhitAccounting({
      source: await mappedSource(), repository, client, now: () => now,
    })).rejects.toBe(error);
    expect(repository.customerFailures).toEqual([
      expect.objectContaining({ status: "retryable_error" }),
    ]);
  });
});
