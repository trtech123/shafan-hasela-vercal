import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const cashRegister = readFileSync(
  new URL("../pages/CashRegister.jsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

describe("CashRegister hosted Pelecard wiring", () => {
  test("initiates the hosted flow with the safe checkout snapshot", () => {
    expect(cashRegister).toContain("beginHostedPelecardPayment");
    expect(cashRegister).toContain("schema_version: 1");
    expect(cashRegister).toContain("import.meta.env.VITE_PELECARD_REDIRECT_ORIGINS");
    expect(cashRegister).not.toContain("frontendEnv.env.VITE_PELECARD_REDIRECT_ORIGINS");
    expect(cashRegister).toContain("onPelecard={handlePelecardStart}");
  });

  test("retains the existing sales insert only for manual payment confirmation", () => {
    expect(cashRegister).toContain("const handlePaymentConfirm = async");
    expect(cashRegister).toMatch(/\.from\(['"]sales['"]\)\s*\.insert\(/s);
    expect(cashRegister).not.toMatch(/handlePaymentConfirm\s*\(\s*["']פלאקארד["']/);
  });

  test("registers the return page under authenticated application routes", () => {
    expect(app).toContain("import PaymentReturn from './pages/PaymentReturn'");
    expect(app).toContain('<Route path="/payment/return" element={<PaymentReturn />} />');
  });
});
