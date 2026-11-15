import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const cashRegister = readFileSync(
  new URL("../pages/CashRegister.jsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

describe("CashRegister hosted Pelecard wiring", () => {
  test("routes linked orders to cashier collection and standalone carts directly to hosted checkout", () => {
    expect(cashRegister).toContain("user?.role === 'admin' || user?.role === 'קופאי'");
    expect(cashRegister).toContain('navigate(`/cashregister?orderId=${encodeURIComponent(linkedOrder.id)}`)');
    expect(cashRegister).toContain("onPelecard={handlePelecardStart}");
    expect(cashRegister).toContain('startPosCheckout(supabase');
    expect(cashRegister).toContain("pelecardEnabled={canPayOrder && (Boolean(linkedOrder?.id)||canHostedCart)}");
    expect(app).toContain('<Route path="/payment/pos" element={<PosPayment />} />');
    expect(cashRegister).not.toContain("beginHostedPelecardPayment");
    expect(cashRegister).not.toContain("pelecard-initiate");
  });

  test("retains the existing sales insert only for manual payment confirmation", () => {
    expect(cashRegister).toContain("const handlePaymentConfirm = async");
    expect(cashRegister).toMatch(/\.from\(['"]sales['"]\)\s*\.insert\(/s);
    expect(cashRegister).not.toMatch(/handlePaymentConfirm\s*\(\s*["']פלאקארד["']/);
  });

  test("registers the return page under authenticated application routes", () => {
    expect(app).toContain("import PaymentReturn from './pages/PaymentReturn'");
    expect(app).toContain('<Route path="/payment/return" element={<PaymentReturnRoute />} />');
    expect(app).toContain('<PaymentReturn />');
  });
});
