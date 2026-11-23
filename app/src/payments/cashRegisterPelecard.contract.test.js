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

  test("routes manual cash and cheque through guarded collection without browser sale insertion", () => {
    expect(cashRegister).toContain("const handlePaymentConfirm = async");
    expect(cashRegister).toContain("if (method !== \"מזומן\" && method !== \"צ'ק\")");
    expect(cashRegister).toContain("supabase.functions.invoke('payper-noncard-collection'");
    expect(cashRegister).not.toMatch(/\.from\(['"]sales['"]\)\s*\.insert\(/s);
    expect(cashRegister).not.toMatch(/handlePaymentConfirm\s*\(\s*["']פלאקארד["']/);
  });

  test("registers the return page under authenticated application routes", () => {
    expect(app).toContain("import PaymentReturn from './pages/PaymentReturn'");
    expect(app).toContain('<Route path="/payment/return" element={<PaymentReturnRoute />} />');
    expect(app).toContain('<PaymentReturn />');
  });
});
