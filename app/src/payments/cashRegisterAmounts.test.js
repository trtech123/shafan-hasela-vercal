import { describe, expect, test } from "vitest";
import { calculateCheckoutTotals } from "./pelecardPayments.js";

describe("cash-register agorot arithmetic", () => {
  test("matches server percentage rounding at agorot precision", () => {
    expect(calculateCheckoutTotals([
      { qty: 1, customPrice: 105 },
    ], { mode: "percentage", value: 10 })).toEqual({
      valid: true,
      subtotal: 105,
      discountAmount: 10.5,
      total: 94.5,
    });
  });

  test.each([
    [{ mode: "percentage", value: "10" }, 10.5, 94.5],
    [{ mode: "fixed", value: "10.50" }, 10.5, 94.5],
  ])("normalizes Cart's string-valued discount input", (
    discount,
    discountAmount,
    total,
  ) => {
    expect(calculateCheckoutTotals([
      { qty: 1, customPrice: 105 },
    ], discount)).toEqual({
      valid: true,
      subtotal: 105,
      discountAmount,
      total,
    });
  });

  test.each([
    [{ qty: 1, customPrice: 10.001 }, null],
    [{ qty: 1, customPrice: 10 }, { mode: "percentage", value: 10.001 }],
    [{ qty: 1, customPrice: 10 }, { mode: "fixed", value: 1.001 }],
  ])("rejects precision the server cannot represent", (item, discount) => {
    expect(calculateCheckoutTotals([item], discount).valid).toBe(false);
  });
});
