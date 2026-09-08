import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AccountingRepository,
  ClaimCustomerInput,
  ClaimDocumentInput,
  CustomerClaim,
  DocumentClaim,
  PersistedFailure,
} from "../../supabase/functions/_shared/rivhit/workflow.ts";
import type { AccountingStatus, RivhitDocumentResult } from "../../supabase/functions/_shared/rivhit/types.ts";

interface CustomerRow extends ClaimCustomerInput {
  id: string;
  status: AccountingStatus;
  externalCustomerId: string | null;
  attemptCount: number;
  retryAfter: string | null;
  failure: PersistedFailure | null;
  lastAttemptAt: string;
  updatedAt: string;
}

interface DocumentRow extends ClaimDocumentInput {
  id: string;
  status: AccountingStatus;
  externalDocumentId: string | null;
  externalDocumentNumber: string | null;
  documentUrl: string | null;
  attemptCount: number;
  retryAfter: string | null;
  failure: PersistedFailure | null;
  lastAttemptAt: string;
  updatedAt: string;
}

interface FileState {
  customers: CustomerRow[];
  documents: DocumentRow[];
}

const EMPTY_STATE: FileState = { customers: [], documents: [] };

function customerClaim(row: CustomerRow, claimed: boolean): CustomerClaim {
  return {
    id: row.id,
    status: row.status,
    externalCustomerId: row.externalCustomerId,
    retryAfter: row.retryAfter,
    claimed,
    attemptCount: row.attemptCount,
  };
}

function documentClaim(row: DocumentRow, claimed: boolean): DocumentClaim {
  return {
    id: row.id,
    status: row.status,
    externalDocumentId: row.externalDocumentId,
    externalDocumentNumber: row.externalDocumentNumber,
    documentUrl: row.documentUrl,
    retryAfter: row.retryAfter,
    claimed,
    attemptCount: row.attemptCount,
  };
}

function dueForClaim(
  row: Pick<CustomerRow, "status" | "retryAfter" | "updatedAt">,
  now: Date,
  staleAfterMilliseconds: number,
): boolean {
  if (row.status === "retryable_error") {
    return !row.retryAfter || new Date(row.retryAfter).getTime() <= now.getTime();
  }
  return row.status === "processing"
    && new Date(row.updatedAt).getTime() + staleAfterMilliseconds <= now.getTime();
}

/**
 * A sandbox-only persistence adapter. Production uses SupabaseAccountingRepository.
 */
export class FileAccountingRepository implements AccountingRepository {
  private readonly path: string;
  private readonly now: () => Date;
  private readonly staleAfterSeconds: number;

  constructor(
    path: string,
    now: () => Date = () => new Date(),
    staleAfterSeconds = 300,
  ) {
    this.path = path;
    this.now = now;
    this.staleAfterSeconds = staleAfterSeconds;
  }

  private async load(): Promise<FileState> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<FileState>;
      return {
        customers: parsed.customers ?? [],
        documents: parsed.documents ?? [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(EMPTY_STATE);
      }
      throw error;
    }
  }

  private async save(state: FileState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await rename(temporaryPath, this.path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM") throw error;
      await rm(this.path, { force: true });
      await rename(temporaryPath, this.path);
    }
  }

  async claimCustomer(input: ClaimCustomerInput): Promise<CustomerClaim> {
    const state = await this.load();
    const now = this.now();
    const existing = state.customers.find((row) =>
      row.provider === input.provider
      && row.accountNamespace === input.accountNamespace
      && row.identityKey === input.identityKey
    );
    if (!existing) {
      const row: CustomerRow = {
        ...input,
        id: randomUUID(),
        status: "processing",
        externalCustomerId: null,
        attemptCount: 1,
        retryAfter: null,
        failure: null,
        lastAttemptAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      state.customers.push(row);
      await this.save(state);
      return customerClaim(row, true);
    }
    if (existing.externalReference !== input.externalReference) {
      throw new Error("accounting customer idempotency mismatch");
    }
    if (!dueForClaim(existing, now, this.staleAfterSeconds * 1000)) {
      return customerClaim(existing, false);
    }
    Object.assign(existing, {
      status: "processing" as const,
      attemptCount: existing.attemptCount + 1,
      retryAfter: null,
      failure: null,
      lastAttemptAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await this.save(state);
    return customerClaim(existing, true);
  }

  async succeedCustomer(
    id: string,
    attemptCount: number,
    externalCustomerId: string,
  ): Promise<void> {
    const state = await this.load();
    const row = state.customers.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`Unknown accounting customer ${id}`);
    this.assertActiveAttempt(row, attemptCount);
    Object.assign(row, {
      status: "succeeded" as const,
      externalCustomerId,
      retryAfter: null,
      failure: null,
      updatedAt: this.now().toISOString(),
    });
    await this.save(state);
  }

  async failCustomer(
    id: string,
    attemptCount: number,
    failure: PersistedFailure,
    externalCustomerId?: string,
  ): Promise<void> {
    const state = await this.load();
    const row = state.customers.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`Unknown accounting customer ${id}`);
    this.assertActiveAttempt(row, attemptCount);
    Object.assign(row, {
      status: failure.status,
      retryAfter: failure.retryAfter,
      failure,
      externalCustomerId: externalCustomerId ?? row.externalCustomerId,
      updatedAt: this.now().toISOString(),
    });
    await this.save(state);
  }

  async claimDocument(input: ClaimDocumentInput): Promise<DocumentClaim> {
    const state = await this.load();
    const now = this.now();
    const existing = state.documents.find((row) =>
      row.provider === input.provider
      && row.accountNamespace === input.accountNamespace
      && row.sourceType === input.sourceType
      && row.sourceId === input.sourceId
      && row.documentTypeKey === input.documentTypeKey
    );
    if (!existing) {
      const row: DocumentRow = {
        ...input,
        id: randomUUID(),
        status: "processing",
        externalDocumentId: null,
        externalDocumentNumber: null,
        documentUrl: null,
        attemptCount: 1,
        retryAfter: null,
        failure: null,
        lastAttemptAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      state.documents.push(row);
      await this.save(state);
      return documentClaim(row, true);
    }
    if (
      existing.accountingCustomerId !== input.accountingCustomerId
      || existing.externalDocumentType !== input.externalDocumentType
      || existing.requestReference !== input.requestReference
      || existing.payloadHash !== input.payloadHash
    ) {
      throw new Error("accounting document idempotency mismatch");
    }
    if (!dueForClaim(existing, now, this.staleAfterSeconds * 1000)) {
      return documentClaim(existing, false);
    }
    Object.assign(existing, {
      status: "processing" as const,
      attemptCount: existing.attemptCount + 1,
      retryAfter: null,
      failure: null,
      lastAttemptAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await this.save(state);
    return documentClaim(existing, true);
  }

  async succeedDocument(
    id: string,
    attemptCount: number,
    result: RivhitDocumentResult,
  ): Promise<void> {
    const state = await this.load();
    const row = state.documents.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`Unknown accounting document ${id}`);
    this.assertActiveAttempt(row, attemptCount);
    Object.assign(row, {
      status: "succeeded" as const,
      externalDocumentId: result.documentId,
      externalDocumentNumber: result.documentNumber,
      documentUrl: result.documentUrl,
      retryAfter: null,
      failure: null,
      updatedAt: this.now().toISOString(),
    });
    await this.save(state);
  }

  async failDocument(
    id: string,
    attemptCount: number,
    failure: PersistedFailure,
    result?: RivhitDocumentResult,
  ): Promise<void> {
    const state = await this.load();
    const row = state.documents.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`Unknown accounting document ${id}`);
    this.assertActiveAttempt(row, attemptCount);
    Object.assign(row, {
      status: failure.status,
      retryAfter: failure.retryAfter,
      failure,
      externalDocumentId: result?.documentId ?? row.externalDocumentId,
      externalDocumentNumber: result?.documentNumber ?? row.externalDocumentNumber,
      documentUrl: result?.documentUrl ?? row.documentUrl,
      updatedAt: this.now().toISOString(),
    });
    await this.save(state);
  }

  private assertActiveAttempt(
    row: Pick<CustomerRow, "status" | "attemptCount">,
    attemptCount: number,
  ): void {
    if (row.status !== "processing" || row.attemptCount !== attemptCount) {
      throw new Error("stale accounting finalization");
    }
  }
}
