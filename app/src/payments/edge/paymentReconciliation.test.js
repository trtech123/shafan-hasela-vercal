import { describe, expect, test } from "vitest";

import {
  reconcilePayment,
} from "../../../../supabase/functions/_shared/payment-reconciliation.ts";

const localPayment = {
  status: "pending_provider",
  amountMinor: 10_000,
  currencyCode: "ILS",
  terminalNumber: "sandbox-terminal-fixture",
  merchantCorrelation: "payment-uuid",
  successfulProviderStatusCodes: ["000"],
};

const callbackNotice = {
  confirmationValid: true,
  providerTransactionId: "651650799",
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

const verifiedResult = (transactionOverrides = {}) => ({
  kind: "verified",
  transaction: {
    ...verifiedTransaction,
    ...transactionOverrides,
  },
});

const decisionFor = ({
  localOverrides = {},
  callbackOverrides = {},
  providerResult = verifiedResult(),
} = {}) => reconcilePayment(
  { ...localPayment, ...localOverrides },
  { ...callbackNotice, ...callbackOverrides },
  providerResult,
);

describe("payment reconciliation", () => {
  test("finalizes a verified success with only the allowlisted transaction fields", () => {
    const result = decisionFor({
      providerResult: verifiedResult({
        rawProviderPayload: { mustNotEscape: true },
        providerPassword: "must-not-escape",
      }),
    });

    expect(result).toEqual({
      kind: "finalize",
      transaction: verifiedTransaction,
    });
    expect(Object.keys(result.transaction)).toEqual(
      Object.keys(verifiedTransaction),
    );
  });

  test.each([
    {
      name: "provider decline",
      providerResult: verifiedResult({ statusCode: "006" }),
      expected: { kind: "fail", code: "provider_declined" },
    },
    {
      name: "forged callback",
      callbackOverrides: { confirmationValid: false },
      expected: { kind: "fail", code: "forged_callback" },
    },
    {
      name: "transaction mismatch",
      providerResult: verifiedResult({
        providerTransactionId: "different-transaction",
      }),
      expected: { kind: "fail", code: "provider_mismatch" },
    },
    {
      name: "terminal mismatch",
      providerResult: verifiedResult({ terminalNumber: "different-terminal" }),
      expected: { kind: "fail", code: "provider_mismatch" },
    },
    {
      name: "amount mismatch",
      providerResult: verifiedResult({ amountMinor: 9_999 }),
      expected: { kind: "fail", code: "amount_mismatch" },
    },
    {
      name: "currency mismatch",
      providerResult: verifiedResult({ currencyCode: "USD" }),
      expected: { kind: "fail", code: "currency_mismatch" },
    },
    {
      name: "merchant correlation mismatch",
      providerResult: verifiedResult({ merchantKey: "different-payment" }),
      expected: { kind: "fail", code: "provider_mismatch" },
    },
    {
      name: "provider timeout",
      providerResult: { kind: "error", code: "provider_timeout" },
      expected: { kind: "remain_pending", code: "provider_timeout" },
    },
    {
      name: "duplicate success",
      localOverrides: { status: "succeeded" },
      expected: { kind: "already_finalized" },
    },
    {
      name: "delayed success after local timeout",
      localOverrides: { status: "timed_out" },
      expected: { kind: "finalize", transaction: verifiedTransaction },
    },
  ])("returns the safe decision for $name", ({
    localOverrides,
    callbackOverrides,
    providerResult,
    expected,
  }) => {
    expect(decisionFor({
      localOverrides,
      callbackOverrides,
      providerResult,
    })).toEqual(expected);
  });

  test.each([
    "failed",
    "refund_pending",
    "refunded",
    "void_pending",
    "voided",
  ])(
    "never downgrades a locally %s payment",
    (status) => {
      expect(decisionFor({
        localOverrides: { status },
        callbackOverrides: { confirmationValid: false },
        providerResult: verifiedResult({ statusCode: "006" }),
      })).toEqual({ kind: "already_finalized" });
    },
  );

  test.each([
    {
      name: "confirmation before provider correlation",
      callbackOverrides: { confirmationValid: false },
      providerResult: verifiedResult({ terminalNumber: "different-terminal" }),
      expected: "forged_callback",
    },
    {
      name: "terminal/correlation before transaction identity",
      providerResult: verifiedResult({
        terminalNumber: "different-terminal",
        providerTransactionId: "different-transaction",
      }),
      expected: "provider_mismatch",
    },
    {
      name: "transaction identity before provider status",
      providerResult: verifiedResult({
        providerTransactionId: "different-transaction",
        statusCode: "006",
      }),
      expected: "provider_mismatch",
    },
    {
      name: "provider status before amount",
      providerResult: verifiedResult({ statusCode: "006", amountMinor: 9_999 }),
      expected: "provider_declined",
    },
    {
      name: "amount before currency",
      providerResult: verifiedResult({ amountMinor: 9_999, currencyCode: "USD" }),
      expected: "amount_mismatch",
    },
  ])("applies $name", ({
    callbackOverrides,
    providerResult,
    expected,
  }) => {
    expect(decisionFor({ callbackOverrides, providerResult })).toEqual({
      kind: "fail",
      code: expected,
    });
  });
});
