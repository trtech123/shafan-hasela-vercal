import { describe, expect, test, vi } from "vitest";
import { lookupVerifiedPayment } from "./diagnostic.ts";

describe("read-only worker credential diagnostic", () => {
  const payment = { id: "28b4786f-e722-40ae-9661-f3e805fc71bf", provider: "pelecard",
    operation: "payment", status: "succeeded", verified_at: "2026-11-02T19:40:00Z",
    provider_transaction_id: "hosted-transaction-id", amount: "3.00", currency: "ILS" };
  const client = (data: unknown) => ({ from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  })) })) })) });

  test("looks up only the stored verified payment and does not write", async () => {
    const db = client(payment);
    const lookupTransaction = vi.fn(async () => "3175016155");
    expect(await lookupVerifiedPayment(payment.id, db, { lookupTransaction }))
      .toEqual({ verified: true, transactionRecordId: "3175016155" });
    expect(lookupTransaction).toHaveBeenCalledExactlyOnceWith("hosted-transaction-id", 300);
    expect(db.from).toHaveBeenCalledExactlyOnceWith("payment_transactions");
  });
  test("rejects unverified and malformed payment records before provider access", async () => {
    const lookupTransaction = vi.fn();
    for (const row of [null, { ...payment, status: "pending_provider" },
      { ...payment, amount: "3.001" }, { ...payment, verified_at: null },
      { ...payment, provider_transaction_id: null }]) {
      await expect(lookupVerifiedPayment(payment.id, client(row), { lookupTransaction }))
        .rejects.toThrow("diagnostic_payment_unavailable");
    }
    expect(lookupTransaction).not.toHaveBeenCalled();
  });
});
