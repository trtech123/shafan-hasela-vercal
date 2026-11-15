import { describe, expect, test, vi } from "vitest";
import { createPayperBookkeepingIntakeObserver } from "./intake.ts";

describe("Payper success bookkeeping intake", () => {
  test("is disabled by default and never calls the database", async () => {
    const rpc = vi.fn();
    const observer = createPayperBookkeepingIntakeObserver({ rpc }, {});
    expect(await observer.capture("payment-1", "succeeded")).toEqual({ status: "disabled" });
    expect(rpc).not.toHaveBeenCalled();
  });

  test("ignores unsuccessful Payper outcomes even when intake is enabled", async () => {
    const rpc = vi.fn();
    const observer = createPayperBookkeepingIntakeObserver({ rpc },
      { RIVHIT_BOOKKEEPING_INTAKE_ENABLED: "true" });
    expect(await observer.capture("payment-1", "reconciliation_required"))
      .toEqual({ status: "not_succeeded" });
    expect(rpc).not.toHaveBeenCalled();
  });

  test("requests capture through a single database RPC and keeps issuance independent", async () => {
    const rpc = vi.fn(async () => ({ data: "intake-id", error: null }));
    const observer = createPayperBookkeepingIntakeObserver({ rpc },
      { RIVHIT_BOOKKEEPING_INTAKE_ENABLED: "true" });
    expect(await observer.capture("payment-1", "succeeded"))
      .toEqual({ status: "held", intakeId: "intake-id" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("capture_succeeded_payper_bookkeeping_intake",
      { p_payment_id: "payment-1" });
  });

  test("a capture failure is reported without replacing Payper success", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "sensitive" } }));
    const observer = createPayperBookkeepingIntakeObserver({ rpc },
      { RIVHIT_BOOKKEEPING_INTAKE_ENABLED: "true" });
    expect(await observer.capture("payment-1", "succeeded"))
      .toEqual({ status: "capture_unavailable" });
  });
});
