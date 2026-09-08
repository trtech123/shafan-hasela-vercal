// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import PaymentReturn from "./PaymentReturn";

const PAYMENT_ID = "10000000-0000-4000-8000-000000000001";
const verifyMock = vi.fn();
const pollMock = vi.fn();
const pendingMock = vi.fn();

vi.mock("@/api/supabaseClient", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

vi.mock("@/payments/pelecardPayments", () => ({
  PELECARD_PENDING_PAYMENT_KEY: "pelecard.pendingPayment.v1",
  getPendingPelecardAttempt: (...args) => pendingMock(...args),
  verifyPelecardReturn: (...args) => verifyMock(...args),
  pollPelecardStatus: (...args) => pollMock(...args),
}));

beforeEach(() => {
  verifyMock.mockReset().mockResolvedValue({
    paymentId: PAYMENT_ID,
    status: "pending_provider",
    saleId: null,
  });
  pollMock.mockReset();
  pendingMock.mockReset().mockReturnValue({
    idempotencyKey: "checkout-attempt-1",
    paymentId: PAYMENT_ID,
  });
  window.sessionStorage.clear();
});

afterEach(cleanup);

function renderPage(path = "/payment/return?opaque=notice") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PaymentReturn />
    </MemoryRouter>,
  );
}

describe("PaymentReturn", () => {
  test("shows an already callback-verified payment from sanitized local status", async () => {
    window.sessionStorage.setItem(
      "pelecard.pendingPayment.v1",
      JSON.stringify({ idempotencyKey: "checkout-attempt-1", paymentId: PAYMENT_ID }),
    );
    pollMock.mockResolvedValue({
      id: PAYMENT_ID,
      status: "succeeded",
      amount: "120.00",
      currency: "ILS",
      receiptNumber: "RCP-1001",
      saleId: "sale-1",
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "התשלום אושר" })).toBeInTheDocument();
    expect(screen.getByText("RCP-1001")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("pelecard.pendingPayment.v1")).not.toBeNull();
    expect(verifyMock).toHaveBeenCalledWith(
      PAYMENT_ID,
      { opaque: "notice" },
      expect.objectContaining({ client: expect.anything() }),
    );
  });

  test("renders pending status updates before browser-return reconciliation completes", async () => {
    pollMock.mockImplementation(async (_id, options) => {
      options.onStatus({ status: "pending_provider", amount: "120.00", currency: "ILS" });
      await Promise.resolve();
      return {
        id: PAYMENT_ID,
        status: "succeeded",
        amount: "120.00",
        currency: "ILS",
        receiptNumber: "RCP-1002",
        saleId: "sale-2",
      };
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "התשלום אושר" })).toBeInTheDocument();
    expect(pollMock).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["failed", "התשלום נדחה"],
    ["timed_out", "הבדיקה הסתיימה ללא תשובה"],
  ])("shows %s without creating a receipt", async (status, heading) => {
    pollMock.mockResolvedValue({
      id: PAYMENT_ID,
      status,
      amount: "120.00",
      currency: "ILS",
      receiptNumber: null,
      saleId: null,
    });
    renderPage("/payment/return");
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  test("fails safely when no local payment correlation exists", async () => {
    pendingMock.mockReturnValue(null);
    renderPage();
    expect(await screen.findByRole("heading", { name: "לא נמצא תשלום לבדיקה" })).toBeInTheDocument();
    expect(verifyMock).not.toHaveBeenCalled();
    expect(pollMock).not.toHaveBeenCalled();
  });
});
