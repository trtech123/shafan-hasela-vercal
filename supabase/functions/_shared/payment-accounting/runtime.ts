import { RivhitClient } from "../rivhit/client.ts";
import { getDocumentMapping, parseDocumentTypeMap } from "../rivhit/config.ts";
import { SupabaseAccountingRepository } from "../rivhit/supabase-repository.ts";
import type { DocumentMapping } from "../rivhit/types.ts";
import type { RivhitAccountingClient } from "../rivhit/workflow.ts";
import {
  processPaymentAccountingEvent,
  type PaymentAccountingEventResult,
  type ProcessPaymentAccountingEventOptions,
} from "./processor.ts";
import { SupabasePaymentAccountingRepository } from "./repository.ts";

interface RuntimeSupabaseClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data?: unknown;
    error?: { message?: string } | null;
  }>;
  from(table: string): {
    select(columns: string): any;
  };
}

export interface PaymentAccountingRuntimeEnv {
  RIVHIT_API_TOKEN?: string;
  RIVHIT_ACCOUNTING_MODE?: string;
  RIVHIT_ACCOUNT_NAMESPACE?: string;
  RIVHIT_DOCUMENT_TYPE_MAP?: string;
}

type ProcessEvent = (
  options: ProcessPaymentAccountingEventOptions,
) => Promise<PaymentAccountingEventResult>;

export interface CreatePaymentAccountingRuntimeOptions {
  serviceClient: RuntimeSupabaseClient;
  env: PaymentAccountingRuntimeEnv;
  workerId?: string;
  leaseSeconds?: number;
  processEvent?: ProcessEvent;
  createRivhitClient?: (apiToken: string) => RivhitAccountingClient;
}

interface AccountingConfiguration {
  issue?: string;
  mappings: Record<string, DocumentMapping>;
  accountNamespace: string;
  client?: RivhitAccountingClient;
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

function accountingConfiguration(
  env: PaymentAccountingRuntimeEnv,
  createClient: (apiToken: string) => RivhitAccountingClient,
): AccountingConfiguration {
  const apiToken = trimmed(env.RIVHIT_API_TOKEN);
  const mode = trimmed(env.RIVHIT_ACCOUNTING_MODE);
  const accountNamespace = trimmed(env.RIVHIT_ACCOUNT_NAMESPACE);
  if (!apiToken) return { issue: "missing_rivhit_api_token", mappings: {}, accountNamespace };
  if (mode !== "sandbox" && mode !== "production") {
    return { issue: "invalid_accounting_mode", mappings: {}, accountNamespace };
  }
  if (!accountNamespace) {
    return { issue: "missing_account_namespace", mappings: {}, accountNamespace };
  }

  let mappings: Record<string, DocumentMapping>;
  try {
    mappings = parseDocumentTypeMap(env.RIVHIT_DOCUMENT_TYPE_MAP);
  } catch {
    return { issue: "invalid_document_mapping", mappings: {}, accountNamespace };
  }
  try {
    const paymentMapping = getDocumentMapping(mappings, "payment_success");
    if (!paymentMapping.currency_code) {
      return { issue: "missing_currency_code", mappings, accountNamespace };
    }
  } catch {
    return { issue: "missing_document_mapping", mappings, accountNamespace };
  }
  return {
    mappings,
    accountNamespace,
    client: createClient(apiToken),
  };
}

export function createPaymentAccountingRuntime(
  options: CreatePaymentAccountingRuntimeOptions,
) {
  const repository = new SupabasePaymentAccountingRepository(options.serviceClient);
  const rivhitRepository = new SupabaseAccountingRepository(options.serviceClient);
  const run = options.processEvent ?? processPaymentAccountingEvent;
  const createClient = options.createRivhitClient
    ?? ((apiToken: string) => new RivhitClient({ apiToken }));
  const configuration = accountingConfiguration(options.env, createClient);
  const workerId = options.workerId ?? `payment-accounting:${crypto.randomUUID()}`;

  const processEvent = (
    eventId: string,
    forceRetry = false,
  ): Promise<PaymentAccountingEventResult> => run({
    eventId,
    workerId,
    leaseSeconds: options.leaseSeconds ?? 300,
    forceRetry,
    repository,
    rivhitRepository,
    rivhitClient: configuration.client,
    documentMappings: configuration.mappings,
    accountNamespace: configuration.accountNamespace,
    configurationIssue: configuration.issue,
  });

  return {
    configurationIssue: configuration.issue,
    processEvent,
    async wakePaymentAccounting(paymentId: string): Promise<void> {
      const durableEventId = await repository.findEventIdForPayment(paymentId);
      if (!durableEventId) return;
      await processEvent(durableEventId, false);
    },
  };
}
