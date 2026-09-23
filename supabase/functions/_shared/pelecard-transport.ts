import { PaymentError, type PaymentProvider, type LookupProviderPayment } from "./payment-types.ts";
import type { PaymentNotificationDecoder, PaymentVerificationProvider } from "./payment-handlers.ts";
import { createPelecardClient } from "./pelecard-client.ts";

type Environment = Record<string, string | undefined>;
type Wire = Record<string, unknown>;
const GATEWAYS = new Set(["https://gateway20.pelecard.biz", "https://gateway21.pelecard.biz"]);

function record(value: unknown): Wire {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PaymentError("invalid_provider_response");
  return value as Wire;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > 2048) throw new PaymentError("invalid_provider_response");
  return value;
}
function envValue(env: Environment, name: string): string {
  const value = env[name];
  if (!value || value.trim() !== value) throw new PaymentError("invalid_configuration");
  return value;
}
function minor(value: unknown): number {
  if ((typeof value !== "string" || !/^\d+$/.test(value)) && typeof value !== "number") throw new PaymentError("invalid_provider_response");
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new PaymentError("invalid_provider_response");
  return amount;
}
function correlatedUrl(value: string, paymentId: string): string {
  const url = new URL(value);
  url.searchParams.set("paymentId", paymentId);
  return url.href;
}

/** Contract: ManualIframe/Chart, About and SandboxServices method 58.
 * No default gateway: selecting a host does not establish TEST vs LIVE.
 * Only allowlisted fields leave this module; never log provider payloads.
 */
export function createPelecardTransport(env: Environment, fetcher: typeof fetch = fetch): PaymentProvider {
  const baseUrl = envValue(env, "PELECARD_BASE_URL");
  if (!GATEWAYS.has(baseUrl)) throw new PaymentError("invalid_configuration");
  const credentials = {
    terminal: envValue(env, "PELECARD_TERMINAL"),
    user: envValue(env, "PELECARD_USER"),
    password: envValue(env, "PELECARD_PASSWORD"),
  };
  async function post(method: string, body: Wire, signal: AbortSignal): Promise<unknown> {
    const response = await fetcher(`${baseUrl}/PaymentGW/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal, redirect: "error",
    });
    if (!response.ok) throw new PaymentError("provider_unavailable");
    try { return await response.json(); } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw error;
      throw new PaymentError("invalid_provider_response");
    }
  }
  async function validate(key: string, uniqueKey: string, amount: number, signal: AbortSignal) {
    const result = await post("ValidateByUniqueKey", { ConfirmationKey: key, UniqueKey: uniqueKey, TotalX100: String(amount) }, signal);
    return result === 1 || result === "1";
  }
  const client = createPelecardClient({
    allowedRedirectOrigins: [baseUrl],
    capabilities: {
      initiate: {
        async transport(input, signal) {
          if (input.currencyCode !== "ILS" || input.merchantKey.length > 50) throw new PaymentError("invalid_input");
          const returnUrl = correlatedUrl(input.returnUrl, input.merchantKey);
          const callbackUrl = correlatedUrl(input.callbackUrl, input.merchantKey);
          return await post("init", {
            ...credentials, Total: String(input.amountMinor), Currency: "1",
            UserKey: input.merchantKey, ActionType: "J4", FreeTotal: "False", CreateToken: "False",
            GoodURL: returnUrl, ErrorURL: returnUrl, CancelURL: returnUrl,
            ServerSideGoodFeedbackURL: callbackUrl, ServerSideErrorFeedbackURL: callbackUrl,
            resultDataKeyName: "result", FeedbackDataTransferMethod: "GET",
          }, signal);
        },
        decode(value) {
          const result = record(value);
          if (result.StatusCode !== undefined && result.StatusCode !== "000") throw new PaymentError("invalid_provider_response");
          const redirectUrl = text(result.URL);
          // Store the documented full hosted URL without inventing an init ID field.
          return { redirectUrl, sessionReference: redirectUrl };
        },
      },
      validateConfirmation: (input, signal) => validate(input.confirmationKey, input.uniqueKey, input.amountMinor, signal),
      lookup: {
        async transport(input: LookupProviderPayment, signal) {
          if (!input.providerTransactionId) throw new PaymentError("provider_unavailable");
          if (input.terminalReference !== credentials.terminal) throw new PaymentError("provider_mismatch");
          const result = record(await post("GetTransaction", { ...credentials, TransactionId: input.providerTransactionId }, signal));
          if (text(result.TransactionId) !== input.providerTransactionId) throw new PaymentError("provider_mismatch");
          // StatusCode describes the lookup operation. ShvaResult describes the charge.
          if (result.StatusCode !== "000") throw new PaymentError("provider_unavailable");
          const amountMinor = minor(result.DebitTotal);
          if (String(result.DebitCurrency) !== "1") throw new PaymentError("provider_mismatch");
          // This key is read directly from Pelecard, never from browser input.
          if (!await validate(text(result.ConfirmationKey), input.merchantCorrelation, amountMinor, signal)) throw new PaymentError("forged_callback");
          const statusCode = text(result.ShvaResult);
          // J5 authorizations and J2 token registration are not a J4 charge.
          if (statusCode === "000" && String(result.JParam) !== "4") throw new PaymentError("invalid_provider_response");
          if (result.ShvaResultEmv !== undefined && result.ShvaResultEmv !== "" && result.ShvaResultEmv !== statusCode) throw new PaymentError("invalid_provider_response");
          return {
            providerTransactionId: input.providerTransactionId,
            // Declines may lack approval. Success MUST have it.
            approvalId: statusCode === "000" ? text(result.DebitApproveNumber) : "not-approved",
            statusCode, amountMinor, currencyCode: "ILS",
            terminalNumber: credentials.terminal, merchantKey: input.merchantCorrelation,
          };
        },
        decode: (value) => value,
      },
    },
  });
  return client;
}

export function verificationAdapter(provider: PaymentProvider): PaymentVerificationProvider {
  return {
    validateConfirmation: (input) => provider.validateConfirmation(input),
    async lookup(input) {
      const transaction = await provider.lookup(input);
      // Evidence comes from validating GetTransaction's key with the local UUID.
      return { transaction, correlationEvidence: { kind: "merchant_correlation", value: transaction.merchantKey } };
    },
  };
}

export function lazyPelecardTransport(env: Environment): PaymentProvider {
  const provider = () => createPelecardTransport(env);
  return {
    assertReady: () => provider().assertReady(),
    initiate: (input) => provider().initiate(input),
    validateConfirmation: (input) => provider().validateConfirmation(input),
    lookup: (input) => provider().lookup(input),
    cancel: (input) => provider().cancel(input),
    refund: (input) => provider().refund(input),
  };
}

export const decodePelecardNotification: PaymentNotificationDecoder = (input) => {
  try {
    let body = record(input.body);
    const paymentId = input.paymentIdHint ?? body.paymentId;
    if (body.notification !== undefined) body = record(body.notification);
    if (body.result !== undefined) {
      // The HTTP parser already caps the complete request at 32 KiB. A full
      // transaction envelope must not inherit the 2 KiB URL/identifier limit.
      if (typeof body.result !== "string" || body.result.length > 32_768) throw new PaymentError("invalid_input");
      body = record(JSON.parse(body.result));
    }
    if (typeof paymentId !== "string") throw new PaymentError("invalid_input");
    return {
      paymentId, uniqueKey: paymentId,
      confirmationKey: text(body.ConfirmationKey),
      providerTransactionId: text(body.PelecardTransactionId ?? body.TransactionId),
    };
  } catch {
    throw new PaymentError("invalid_input");
  }
};
