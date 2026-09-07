import { describe, expect, test, vi } from "vitest";

import {
  createPelecardClient,
} from "../../../../supabase/functions/_shared/pelecard-client.ts";

const initiation = {
  amountMinor: 10_000,
  currencyCode: "ILS",
  merchantKey: "payment-uuid",
  returnUrl: "https://app.example.test/payment/return",
  callbackUrl: "https://edge.example.test/pelecard-callback",
};

const verifiedTransaction = {
  providerTransactionId: "651650799",
  approvalId: "0000000",
  statusCode: "000",
  amountMinor: 10_000,
  currencyCode: "ILS",
  terminalNumber: "sandbox-terminal-fixture",
  merchantKey: "payment-uuid",
};

const createConfig = (capabilities = {}, overrides = {}) => ({
  allowedRedirectHosts: ["gateway20.pelecard.biz"],
  capabilities,
  ...overrides,
});

const expectPaymentError = async (promise, code) => {
  await expect(promise).rejects.toMatchObject({
    name: "PaymentError",
    code,
    message: code,
  });
};

describe("Pelecard provider client", () => {
  test("returns only the safe hosted redirect and session reference", async () => {
    const rawProviderResponse = {
      redirectUrl: "https://gateway20.pelecard.biz/PaymentGW/?session=fixture",
      sessionReference: "hosted-session-fixture",
      username: "provider-user-must-not-escape",
      password: "provider-password-must-not-escape",
      raw: { response: "must-not-escape" },
    };
    const transport = vi.fn().mockResolvedValue(rawProviderResponse);
    const client = createPelecardClient(createConfig({
      initiate: { transport, decode: (raw) => raw },
    }));

    const result = await client.initiate(initiation);

    expect(result).toEqual({
      redirectUrl: "https://gateway20.pelecard.biz/PaymentGW/?session=fixture",
      sessionReference: "hosted-session-fixture",
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  test("reduces an authoritative provider response to the exact safe transaction", async () => {
    const rawProviderResponse = {
      ...verifiedTransaction,
      pan: "4111111111111111",
      cvv: "123",
      expiry: "12/99",
      cardToken: "provider-card-token",
      raw: { provider: "body" },
    };
    const transport = vi.fn().mockResolvedValue(rawProviderResponse);
    const client = createPelecardClient(createConfig({
      lookup: { transport, decode: (raw) => raw },
    }));

    const result = await client.lookup("651650799");

    expect(result).toEqual(verifiedTransaction);
    expect(Object.keys(result)).toEqual(Object.keys(verifiedTransaction));
  });

  test("fails closed when a decoded provider response is invalid", async () => {
    const client = createPelecardClient(createConfig({
      lookup: {
        transport: vi.fn().mockResolvedValue({
          ...verifiedTransaction,
          amountMinor: 10_000.5,
        }),
        decode: (raw) => raw,
      },
    }));

    await expectPaymentError(
      client.lookup("651650799"),
      "invalid_provider_response",
    );
  });

  test.each([
    ["non-HTTPS", "http://gateway20.pelecard.biz/PaymentGW/?session=fixture"],
    ["non-allowlisted", "https://evil.example/PaymentGW/?session=fixture"],
  ])("rejects a %s hosted redirect", async (_description, redirectUrl) => {
    const client = createPelecardClient(createConfig({
      initiate: {
        transport: vi.fn().mockResolvedValue({
          redirectUrl,
          sessionReference: "hosted-session-fixture",
        }),
        decode: (raw) => raw,
      },
    }));

    await expectPaymentError(
      client.initiate(initiation),
      "invalid_provider_response",
    );
  });

  test("maps AbortError to a safe provider_timeout error", async () => {
    const abortError = new Error("raw timeout details must not escape");
    abortError.name = "AbortError";
    const client = createPelecardClient(createConfig({
      initiate: {
        transport: vi.fn().mockRejectedValue(abortError),
        decode: (raw) => raw,
      },
    }));

    await expectPaymentError(client.initiate(initiation), "provider_timeout");
  });

  test("maps the native timeout signal reason to provider_timeout", async () => {
    const transport = vi.fn().mockImplementation((_input, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      })
    );
    const client = createPelecardClient(createConfig(
      { initiate: { transport, decode: (raw) => raw } },
      { timeoutMs: 1 },
    ));

    await expectPaymentError(client.initiate(initiation), "provider_timeout");
    expect(transport).toHaveBeenCalledOnce();
  });

  test("fails closed when authoritative lookup is not configured", async () => {
    const client = createPelecardClient(createConfig());

    await expectPaymentError(
      client.lookup("651650799"),
      "capability_unconfigured",
    );
  });

  test("rejects a false injected confirmation validation as forged", async () => {
    const client = createPelecardClient(createConfig({
      validateConfirmation: vi.fn().mockResolvedValue(false),
    }));

    await expectPaymentError(
      client.validateConfirmation({
        confirmationKey: "dummy-confirmation-key",
        uniqueKey: "payment-uuid",
        amountMinor: 10_000,
      }),
      "forged_callback",
    );
  });

  test("rejects a lookup whose returned transaction id does not match", async () => {
    const client = createPelecardClient(createConfig({
      lookup: {
        transport: vi.fn().mockResolvedValue({
          ...verifiedTransaction,
          providerTransactionId: "different-transaction",
        }),
        decode: (raw) => raw,
      },
    }));

    await expectPaymentError(
      client.lookup("651650799"),
      "provider_mismatch",
    );
  });

  test("keeps cancel and refund disabled without making transport calls", async () => {
    const cancelCapability = vi.fn().mockResolvedValue(undefined);
    const client = createPelecardClient(createConfig(
      { cancel: cancelCapability },
      { cancelEnabled: false, refundEnabled: false },
    ));

    await expectPaymentError(
      client.cancel({ providerTransactionId: "651650799" }),
      "capability_disabled",
    );
    await expectPaymentError(
      client.refund({ providerTransactionId: "651650799", amountMinor: 5_000 }),
      "capability_disabled",
    );
    expect(cancelCapability).not.toHaveBeenCalled();
  });

  test("does not invent refund behavior when the confirmed capability is absent", async () => {
    const client = createPelecardClient(createConfig(
      {},
      { refundEnabled: true },
    ));

    await expectPaymentError(
      client.refund({ providerTransactionId: "651650799", amountMinor: 5_000 }),
      "capability_unconfigured",
    );
  });
});
