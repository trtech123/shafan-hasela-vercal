import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { RivhitClient } from "../../supabase/functions/_shared/rivhit/client.ts";
import { mapOrderToAccountingSource } from "../../supabase/functions/_shared/rivhit/order-mapper.ts";
import { runRivhitAccounting } from "../../supabase/functions/_shared/rivhit/workflow.ts";
import { FileAccountingRepository } from "./file-repository.ts";
import {
  documentTypesFromEnvelope,
  type DocumentTypeEnvelope,
} from "./sandbox-document-types.ts";

const RIVHIT_BASE_URL = "https://api.rivhit.co.il/online/RivhitOnlineAPI.svc";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integerEnv(name: string, fallback?: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return Number(value);
}

async function assertSandboxDocumentType(apiToken: string, documentType: number): Promise<void> {
  const response = await fetch(`${RIVHIT_BASE_URL}/Document.TypeList`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_token: apiToken }),
  });
  const envelope = await response.json() as DocumentTypeEnvelope & {
    error_code?: number | string;
    client_message?: string;
  };
  if (!response.ok || Number(envelope.error_code ?? 0) !== 0) {
    throw new Error(`Rivhit Document.TypeList failed (${response.status})`);
  }
  const types = documentTypesFromEnvelope(envelope);
  const selected = types.find((candidate) =>
    Number(candidate.document_type ?? candidate.id) === documentType
  );
  if (!selected) {
    throw new Error(`RIVHIT_TEST_DOCUMENT_TYPE ${documentType} is not available in the sandbox`);
  }
  if (selected.is_accounting === false) {
    throw new Error(`RIVHIT_TEST_DOCUMENT_TYPE ${documentType} is not an accounting document`);
  }
}

async function main(): Promise<void> {
  const apiToken = requiredEnv("RIVHIT_API_TOKEN");
  const testDocumentType = integerEnv("RIVHIT_TEST_DOCUMENT_TYPE");
  if (testDocumentType < 1 || testDocumentType > 999) {
    throw new Error("RIVHIT_TEST_DOCUMENT_TYPE must be between 1 and 999");
  }
  if (requiredEnv("RIVHIT_ACCOUNTING_MODE") !== "sandbox") {
    throw new Error("The live verifier only runs with RIVHIT_ACCOUNTING_MODE=sandbox");
  }

  await assertSandboxDocumentType(apiToken, testDocumentType);

  const sourceId = randomUUID();
  const runLabel = sourceId.slice(0, 8);
  const statePath = resolve(process.cwd(), ".tmp", `rivhit-sandbox-${sourceId}.json`);
  let documentNewCalls = 0;
  const countingFetch: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/Document.New")) documentNewCalls += 1;
    return fetch(input, init);
  };
  const client = new RivhitClient({ apiToken, fetchImpl: countingFetch });
  const source = await mapOrderToAccountingSource(
    {
      id: sourceId,
      order_number: `TEST-${runLabel}`,
      client_name: `Shafan Sandbox ${runLabel}`,
      client_phone: "0500000000",
      client_email: `sandbox+${runLabel}@example.com`,
      num_participants: 1,
      price_per_person: 1,
      total_price: 1,
    },
    "Rivhit sandbox proof",
    "sandbox_test",
    {
      document_type: testDocumentType,
      sort_code: integerEnv("RIVHIT_TEST_SORT_CODE", 100),
      currency_id: integerEnv("RIVHIT_TEST_CURRENCY_ID", 1),
      price_include_vat: true,
      send_mail: false,
      digital_signature: false,
    },
  );

  const firstResult = await runRivhitAccounting({
    source,
    repository: new FileAccountingRepository(statePath),
    client,
  });
  if (firstResult.status !== "succeeded" || firstResult.duplicate) {
    throw new Error("The first sandbox accounting run did not create a document");
  }
  const documentCallsAfterFirst = documentNewCalls;

  const secondResult = await runRivhitAccounting({
    source,
    repository: new FileAccountingRepository(statePath),
    client,
  });
  if (secondResult.status !== "succeeded" || !secondResult.duplicate) {
    throw new Error("The second sandbox accounting run was not recognized as a duplicate");
  }
  if (documentNewCalls !== documentCallsAfterFirst) {
    throw new Error("Document.New was called again for the same local accounting request");
  }
  if (
    firstResult.documentId !== secondResult.documentId
    || firstResult.documentNumber !== secondResult.documentNumber
    || firstResult.documentUrl !== secondResult.documentUrl
  ) {
    throw new Error("The duplicate result did not return the persisted Rivhit document");
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "sandbox",
    sourceId,
    customerId: firstResult.customerId,
    documentId: firstResult.documentId,
    documentNumber: firstResult.documentNumber,
    documentUrl: firstResult.documentUrl,
    documentNewCalls,
    secondRunDuplicate: secondResult.duplicate,
    persistedState: statePath,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
