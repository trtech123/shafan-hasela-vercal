// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import PaymentScreen from "./PaymentScreen";

afterEach(cleanup);

function renderPayment(overrides = {}) {
  const props = {
    total: 120,
    cartItems: [{ id: "a1", name: "Activity", qty: 1, customPrice: 120 }],
    onConfirm: vi.fn(),
    onPelecard: vi.fn(),
    onBack: vi.fn(),
    pelecardBusy: false,
    ...overrides,
  };
  render(<PaymentScreen {...props} />);
  return props;
}

describe("PaymentScreen payment-method separation", () => {
  test("keeps אשראי as an explicitly external/manual payment", () => {
    const props = renderPayment();
    fireEvent.click(screen.getByRole("button", { name: /אשראי.*חיצוני/s }));
    expect(props.onConfirm).toHaveBeenCalledWith("אשראי");
    expect(props.onPelecard).not.toHaveBeenCalled();
  });

  test("starts Pelecard only for an eligible linked order", () => {
    const props = renderPayment({ pelecardEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: /פלאקארד/s }));
    expect(props.onPelecard).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  test("does not offer a standalone cart a broken Pelecard initiation", () => {
    const props = renderPayment({ pelecardEnabled: false });
    const button = screen.getByRole("button", { name: /פלאקארד/s });
    expect(button).toBeDisabled();
    expect(screen.getByText(/יש לקשר הזמנה קיימת/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(props.onPelecard).not.toHaveBeenCalled();
  });

  test("disables only the verified provider action while initiation is running", () => {
    renderPayment({ pelecardBusy: true });
    expect(screen.getByRole("button", { name: /פלאקארד/s })).toBeDisabled();
    expect(screen.getByRole("button", { name: /אשראי.*חיצוני/s })).toBeEnabled();
  });
});
