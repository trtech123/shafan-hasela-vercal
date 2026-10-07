import type { PelecardTestConfig } from "./pelecard-test-config.ts";
import { PaymentError } from "./payment-types.ts";
import { logPelecardTestTransportFailure } from "./pelecard-test-diagnostics.ts";

// Initialization follows the official IFrame Chart (gateway20). REST retrieval
// and validation follow the supplied January 2025 manual, pp17–18 (gateway21).
// Paths are selected per API, never via a shared configurable base or failover.
export const PELECARD_TEST_ENDPOINTS = Object.freeze({
  init: "https://gateway20.pelecard.biz/PaymentGW/init",
  lookup: "https://gateway21.pelecard.biz/PaymentGW/GetTransaction",
  validate: "https://gateway21.pelecard.biz/PaymentGW/ValidateByUniqueKey",
  preflight: "https://gateway21.pelecard.biz/services/GetTerminalName",
});

type RecordValue = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readProviderTransactionId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 100 || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) {
    throw new PaymentError("invalid_input");
  }
  return value;
}

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentError("invalid_provider_response");
  }
  return value as RecordValue;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > 2048) {
    throw new PaymentError("invalid_provider_response");
  }
  return value;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok || response.redirected || !response.body) {
    throw new PaymentError("provider_unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 65_536) {
      await reader.cancel();
      throw new PaymentError("invalid_provider_response");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PaymentError("invalid_provider_response");
  }
}

export interface TestVerificationInput {
  id: string;
  amountMinor: number;
  confirmationKey: string;
  transactionId: string;
}

export interface TestVerifiedResult {
  status: "test_verified";
  transactionId: string;
  apiStatus: "000";
  transactionStatus: "000";
}

export function createPelecardTestProvider(
  config: PelecardTestConfig,
  fetcher: typeof fetch = fetch,
  initAdapter?: (id: string) => Promise<unknown>,
) {
  if (config.mode !== "test") throw new PaymentError("capability_disabled");

  async function post(operation: keyof typeof PELECARD_TEST_ENDPOINTS, body: RecordValue, testPaymentId?: string): Promise<unknown> {
    let response: Response | undefined;
    try {
      response = await fetcher(PELECARD_TEST_ENDPOINTS[operation], {
        method: "POST",
        redirect: "error", // Never forward authentication to a redirect target.
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      return await readBoundedJson(response);
    } catch (error) {
      logPelecardTestTransportFailure(error, {
        operation, testPaymentId, httpStatus: response?.status,
        stage: !response ? "fetch" : !response.ok || response.redirected ? "http_response" : "response_body",
      });
      if (error instanceof PaymentError) throw error;
      // Provider errors may echo the request; never propagate their content.
      throw new PaymentError("provider_unavailable");
    }
  }

  return {
    async preflight(): Promise<{ authenticated: true }> {
      // Read-only terminal metadata; no transaction creation, card or history.
      const response = record(await post("preflight", {
        terminalNumber: config.terminal, user: config.user, password: config.password,
      }));
      if (response.StatusCode !== "000" || !record(response.ResultData).Result) {
        throw new PaymentError("invalid_provider_response");
      }
      return { authenticated: true };
    },

    async initiate(input: { id: string; amountMinor: number; feedbackUrl: string }) {
      if (!UUID.test(input.id) || input.amountMinor !== 100) throw new PaymentError("invalid_input");
      let feedback: URL;
      try { feedback = new URL(input.feedbackUrl); } catch { throw new PaymentError("invalid_configuration"); }
      if (feedback.protocol !== "https:" || feedback.username || feedback.password || feedback.search || feedback.hash) {
        throw new PaymentError("invalid_configuration");
      }
      const callbackUrl = new URL(feedback);
      callbackUrl.searchParams.set("testPaymentId", input.id);
      const returnUrl = new URL(callbackUrl);
      returnUrl.searchParams.set("return", "1");
      const response = record(initAdapter ? await initAdapter(input.id) : await post("init", {
        terminal: config.terminal, user: config.user, password: config.password,
        ActionType: "J4", Currency: "1", Total: "100", UserKey: input.id,
        GoodURL: returnUrl.href, ErrorURL: returnUrl.href, CancelURL: returnUrl.href,
        ServerSideGoodFeedbackURL: callbackUrl.href,
        ServerSideErrorFeedbackURL: callbackUrl.href,
        resultDataKeyName: "testResult",
      }, input.id));
      if (response.StatusCode !== undefined && response.StatusCode !== "000") {
        throw new PaymentError("invalid_provider_response");
      }
      const redirectUrl = text(response.URL);
      let url: URL;
      try { url = new URL(redirectUrl); } catch { throw new PaymentError("invalid_provider_response"); }
      if (url.origin !== "https://gateway20.pelecard.biz" || url.username || url.password) {
        throw new PaymentError("invalid_provider_response");
      }
      // Reject accidental provider echoes of authentication in browser URLs.
      for (const value of [config.user, config.password, config.terminal]) {
        if (redirectUrl.includes(value) || redirectUrl.includes(encodeURIComponent(value))) {
          throw new PaymentError("invalid_provider_response");
        }
      }
      return { redirectUrl, confirmationKey: text(response.ConfirmationKey) };
    },

    async verify(input: TestVerificationInput): Promise<TestVerifiedResult> {
      readProviderTransactionId(input.transactionId);
      if (!UUID.test(input.id) || input.amountMinor !== 100 || !input.confirmationKey) {
        throw new PaymentError("invalid_input");
      }
      const response = record(await post("lookup", {
        terminal: config.terminal, user: config.user, password: config.password,
        TransactionId: input.transactionId,
      }, input.id));
      // API success is separate from payment success. No numeric coercion,
      // padding, substring matching, or acceptance of support's unmapped "00".
      if (response.StatusCode !== "000") throw new PaymentError("invalid_provider_response");
      const transaction = record(response.ResultData);
      if (transaction.ShvaResult !== "000" ||
        (transaction.ShvaResultEmv !== undefined && transaction.ShvaResultEmv !== "000")) {
        throw new PaymentError("invalid_provider_response");
      }
      if (transaction.TransactionId !== input.transactionId ||
        transaction.ConfirmationKey !== input.confirmationKey ||
        transaction.DebitTotal !== String(input.amountMinor) || transaction.DebitCurrency !== "1" ||
        transaction.JParam !== "4" || !["1", "01", "2", "02"].includes(String(transaction.DebitType)) ||
        !["1", "2", "3"].includes(String(transaction.ApprovedBy))) {
        throw new PaymentError("provider_mismatch");
      }
      text(transaction.DebitApproveNumber);
      // Bind provider-held confirmation to our immutable UUID and fixed amount.
      // This is anti-forgery evidence ONLY, after authoritative debit checks.
      const valid = await post("validate", {
        ConfirmationKey: transaction.ConfirmationKey, UniqueKey: input.id,
        TotalX100: String(input.amountMinor),
      }, input.id);
      if (valid !== 1) throw new PaymentError("forged_callback");
      return { status: "test_verified", transactionId: input.transactionId, apiStatus: "000", transactionStatus: "000" };
    },
  };
}
