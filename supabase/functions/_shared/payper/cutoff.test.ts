import { describe, expect, test } from "vitest";
import { isPostActivationPayment } from "./cutoff.ts";

describe("Payper UTC activation cutoff", () => {
  const cutoff = "2026-11-01T10:00:00.000Z";
  test("requires attempt creation and verified finalization at or after cutoff", () => {
    expect(isPostActivationPayment(cutoff, cutoff, cutoff)).toBe(true);
    expect(isPostActivationPayment("2026-11-01T10:00:00.001Z", "2026-11-01T10:00:01Z", cutoff)).toBe(true);
    expect(isPostActivationPayment("2026-11-01T09:59:59.999Z", "2026-11-01T10:01:00Z", cutoff)).toBe(false);
    expect(isPostActivationPayment("2026-11-01T09:00:00Z", "2026-11-02T10:00:00Z", cutoff)).toBe(false);
    expect(isPostActivationPayment(cutoff, "2026-11-01T09:59:59.999Z", cutoff)).toBe(false);
  });
  test("compares explicit timezone offsets as UTC instants and rejects missing timestamps", () => {
    expect(isPostActivationPayment("2026-11-01T12:00:00+02:00", cutoff, cutoff)).toBe(true);
    expect(isPostActivationPayment("2026-11-01T09:59:59+00:00", cutoff, cutoff)).toBe(false);
    expect(isPostActivationPayment("2026-11-01T09:59:59.999999Z", cutoff, "2026-11-01T10:00:00Z")).toBe(false);
    expect(isPostActivationPayment("2026-11-01T10:00:00.000499Z", cutoff, "2026-11-01T10:00:00.000500Z")).toBe(false);
    expect(isPostActivationPayment("2026-11-01 10:00:00", cutoff, cutoff)).toBe(false);
    expect(isPostActivationPayment(cutoff, cutoff, null)).toBe(false);
  });
});
