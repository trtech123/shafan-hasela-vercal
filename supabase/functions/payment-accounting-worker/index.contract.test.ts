import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const callbackSource = readFileSync(
  new URL("../pelecard-callback/index.ts", import.meta.url),
  "utf8",
);
const verifySource = readFileSync(
  new URL("../pelecard-verify/index.ts", import.meta.url),
  "utf8",
);
const configSource = readFileSync(
  new URL("../../config.toml", import.meta.url),
  "utf8",
);

describe("payment accounting worker Edge contracts", () => {
  test("composes protected handler from server accounting runtime", () => {
    expect(source).toContain("createPaymentAccountingEdgeRuntime");
    expect(source).toContain("createPaymentAccountingWorkerHandler");
    expect(source).not.toMatch(/body\??\.(source|payment|amount|documentType)/);
  });

  test("wires the UUID-only payment success hook into callback and verify", () => {
    for (const entrypoint of [callbackSource, verifySource]) {
      expect(entrypoint).toContain("onPaymentSucceeded");
      expect(entrypoint).toContain("schedulePaymentAccountingWake");
    }
  });

  test("exposes only the provider callback without disabling JWT on staff endpoints", () => {
    expect(configSource).toMatch(
      /\[functions\.pelecard-callback\]\s*verify_jwt\s*=\s*false/,
    );
    expect(configSource).not.toMatch(
      /\[functions\.(?:pelecard-verify|payment-accounting-worker)\]\s*verify_jwt\s*=\s*false/,
    );
  });
});
