import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FileAccountingRepository } from "./file-repository.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

async function statePath() {
  const directory = await mkdtemp(join(tmpdir(), "rivhit-ledger-"));
  temporaryDirectories.push(directory);
  return join(directory, "state.json");
}

const customerInput = {
  provider: "rivhit",
  identityKey: "identity",
  externalReference: "shreference",
};

const documentInput = {
  provider: "rivhit",
  accountingCustomerId: "customer-row",
  sourceType: "order",
  sourceId: "11111111-1111-4111-8111-111111111111",
  documentTypeKey: "sandbox_test",
  externalDocumentType: 1,
  requestReference: "request-ref",
  payloadHash: "payload-hash",
};

describe("FileAccountingRepository", () => {
  test("persists customer and document success across repository instances", async () => {
    const path = await statePath();
    const first = new FileAccountingRepository(path);
    const customer = await first.claimCustomer(customerInput);
    expect(customer).toMatchObject({ claimed: true, status: "processing", attemptCount: 1 });
    await first.succeedCustomer(customer.id, "1234");

    const document = await first.claimDocument({
      ...documentInput,
      accountingCustomerId: customer.id,
    });
    expect(document).toMatchObject({ claimed: true, status: "processing", attemptCount: 1 });
    await first.succeedDocument(document.id, {
      customerId: "1234",
      documentType: 1,
      documentId: "doc-id",
      documentNumber: "42",
      documentUrl: "https://api.rivhit.co.il/pdf/test",
      amount: 100,
    });

    const reloaded = new FileAccountingRepository(path);
    await expect(reloaded.claimCustomer(customerInput)).resolves.toMatchObject({
      claimed: false,
      status: "succeeded",
      externalCustomerId: "1234",
    });
    await expect(reloaded.claimDocument({
      ...documentInput,
      accountingCustomerId: customer.id,
    })).resolves.toMatchObject({
      claimed: false,
      status: "succeeded",
      externalDocumentId: "doc-id",
      externalDocumentNumber: "42",
      documentUrl: "https://api.rivhit.co.il/pdf/test",
    });
  });

  test("reclaims retryable work only after retry_after", async () => {
    const path = await statePath();
    let now = new Date("2026-09-07T12:00:00.000Z");
    const repository = new FileAccountingRepository(path, () => now);
    const customer = await repository.claimCustomer(customerInput);
    await repository.succeedCustomer(customer.id, "1234");
    const document = await repository.claimDocument({
      ...documentInput,
      accountingCustomerId: customer.id,
    });
    await repository.failDocument(document.id, {
      status: "retryable_error",
      retryAfter: "2026-09-07T12:01:00.000Z",
      error: {
        message: "network",
        errorCode: null,
        httpStatus: null,
        clientMessage: null,
        debugMessage: null,
      },
    });

    await expect(repository.claimDocument({
      ...documentInput,
      accountingCustomerId: customer.id,
    })).resolves.toMatchObject({ claimed: false, status: "retryable_error" });

    now = new Date("2026-09-07T12:01:01.000Z");
    await expect(repository.claimDocument({
      ...documentInput,
      accountingCustomerId: customer.id,
    })).resolves.toMatchObject({ claimed: true, status: "processing", attemptCount: 2 });
  });

  test("rejects idempotency reuse with a changed payload", async () => {
    const path = await statePath();
    const repository = new FileAccountingRepository(path);
    const customer = await repository.claimCustomer(customerInput);
    await repository.succeedCustomer(customer.id, "1234");
    await repository.claimDocument({
      ...documentInput,
      accountingCustomerId: customer.id,
    });

    await expect(repository.claimDocument({
      ...documentInput,
      accountingCustomerId: customer.id,
      payloadHash: "changed",
    })).rejects.toThrow("accounting document idempotency mismatch");
  });
});
