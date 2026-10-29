import { describe, expect, test } from "vitest";
import { DisabledPayperProvider, nextPayperLedgerState } from "./boundary.ts";

describe("disabled Payper provider boundary", () => {
  test("cannot dispatch or interpret a configuration value as permission", async () => {
    const provider = new DisabledPayperProvider();
    await expect(provider.createDocument()).rejects.toThrow("payper_dispatch_disabled");
  });

  test("allows only a frozen source before a dispatch reservation", () => {
    expect(nextPayperLedgerState("eligible", "freeze_source")).toBe("source_frozen");
    expect(() => nextPayperLedgerState("eligible", "reserve_dispatch")).toThrow();
  });

  test("uncertain dispatch is terminal until manual reconciliation", () => {
    expect(nextPayperLedgerState("dispatch_reserved", "uncertain")).toBe("reconciliation_required");
    expect(() => nextPayperLedgerState("reconciliation_required", "reserve_dispatch")).toThrow();
    expect(() => nextPayperLedgerState("source_blocked", "reserve_dispatch")).toThrow();
    expect(() => nextPayperLedgerState("succeeded", "reserve_dispatch")).toThrow();
  });
});
