import { createPayperLedger } from "./ledger.ts";
import { issueFrozenPayperDocument } from "./issuance.ts";
import { createPelecardPayperProvider } from "./provider.ts";

interface ServiceClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data?: unknown; error?: unknown }>;
}
export interface PayperRuntimeEnv {
  PELECARD_TERMINAL?: string; PELECARD_USER?: string; PELECARD_PASSWORD?: string;
  PAYPER_DISPATCH_ENABLED?: string;
}

/** Explicit application switch plus independent database activation gate. */
export function createPayperIssuanceRuntime(options: {
  serviceClient: ServiceClient; env: PayperRuntimeEnv; fetcher?: typeof fetch;
}) {
  const credentials = {
    terminalNumber: options.env.PELECARD_TERMINAL ?? "",
    user: options.env.PELECARD_USER ?? "",
    password: options.env.PELECARD_PASSWORD ?? "",
  };
  const enabled = options.env.PAYPER_DISPATCH_ENABLED === "true";
  const ledger = createPayperLedger(options.serviceClient, enabled);
  return {
    holdFailure: ledger.holdFailure,
    async issue(paymentId: string) {
      // Constructor checks credentials before any database or provider action.
      const provider = createPelecardPayperProvider({ credentials, fetcher: options.fetcher,
        dispatchEnabled: enabled });
      return issueFrozenPayperDocument(paymentId, { ledger, provider, credentials });
    },
  };
}
