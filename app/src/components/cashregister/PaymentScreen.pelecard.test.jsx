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
    noncardEnabled: { cash: true, check: false },
    ...overrides,
  };
  render(<PaymentScreen {...props} />);
  return props;
}

describe("PaymentScreen payment-method separation", () => {
  test("explains disabled cash and check before confirmation", () => {
    const props = renderPayment({ noncardEnabled: { cash: false, check: false } });
    expect(screen.getByRole('button', { name: /מזומן.*עדיין לא פעיל/s })).toBeDisabled();
    expect(screen.getByRole('button', { name: /צ'ק.*עדיין לא פעיל/s })).toBeDisabled();
    expect(screen.getByText(/ממתין לאישור פרטי ההמחאה על ידי הספק/)).toBeInTheDocument();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
  test("records received cash with billing for the required Invoice-Receipt", () => {
    const props = renderPayment();
    fireEvent.click(screen.getByRole("button", { name: /מזומן/ }));
    expect(props.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('cashier-pay'));
    fireEvent.change(screen.getByLabelText('מזומן שהתקבל (₪)'), { target: { value: '150' } });
    expect(screen.getByText('עודף: 30.00 ₪')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('סוג לקוח'), { target: { value: 'organization' } });
    fireEvent.change(screen.getByLabelText('שם לחיוב'), { target: { value: 'Club' } });
    fireEvent.change(screen.getByLabelText('מספר זהות / חברה'), { target: { value: '123456789' } });
    fireEvent.change(screen.getByLabelText('דוא״ל למסמך'), { target: { value: 'club@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'אשר קבלת מזומן' }));
    expect(props.onConfirm).toHaveBeenCalledWith('מזומן', expect.objectContaining({
      document_type: 'invoice-receipt', billing: expect.objectContaining({ email: 'club@example.com' }),
    }));
  });
  test("keeps אשראי as an explicitly external/manual payment", () => {
    const props = renderPayment();
    fireEvent.click(screen.getByRole("button", { name: /אשראי.*חיצוני/s }));
    expect(props.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('cashier-pay'));
    expect(props.onConfirm).toHaveBeenCalledWith("אשראי");
    expect(props.onPelecard).not.toHaveBeenCalled();
  });

  test("a role newly admitted for physical payment cannot use legacy manual sale methods", () => {
    const props = renderPayment({ manualMethodsEnabled: false, noncardEnabled: { cash: false, check: false } });
    expect(screen.getByRole("button", { name: /אשראי.*חיצוני/s })).toBeDisabled();
    expect(screen.getByRole("button", { name: /העברה בנקאית/s })).toBeDisabled();
    expect(screen.getByRole("button", { name: /ביט \/ Paybox/s })).toBeDisabled();
    expect(screen.getByRole("button", { name: /חשבונית \/ חח״ד/s })).toBeDisabled();
    expect(screen.getAllByText('אמצעי תשלום זה אינו זמין לתפקיד זה').length).toBeGreaterThan(0);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  test("starts Pelecard for an eligible linked order or standalone cart", () => {
    const props = renderPayment({ pelecardEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: /פלאקארד/s }));
    expect(props.onPelecard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('cashier-pay'));
    expect(props.onPelecard).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'פרטי חיוב לתשלום דיגיטלי' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('שם לחיוב'), { target: { value: 'Test Customer' } });
    fireEvent.change(screen.getByLabelText('מספר זהות / חברה'), { target: { value: '123456782' } });
    fireEvent.change(screen.getByLabelText('דוא״ל למסמך'), { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'המשך לפלאקארד' }));
    expect(props.onPelecard).toHaveBeenCalledTimes(1);
    expect(props.onPelecard).toHaveBeenCalledWith({ kind: 'person', name: 'Test Customer', identity: '123456782', email: 'test@example.com' });
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  test('explains guest billing blocker before initiating a digital payment', () => {
    const props = renderPayment({ pelecardEnabled: true });
    fireEvent.click(screen.getByRole('button', { name: /פלאקארד/s }));
    fireEvent.click(screen.getByTestId('cashier-pay'));
    fireEvent.click(screen.getByLabelText('אין ללקוח פרטים מלאים כרגע'));
    expect(screen.getByRole('status')).toHaveTextContent('אי אפשר להתחיל תשלום זה');
    expect(screen.getByRole('button', { name: 'המשך לפלאקארד' })).toBeDisabled();
    expect(props.onPelecard).not.toHaveBeenCalled();
  });

  test("does not offer hosted payment for an ineligible cart", () => {
    const props = renderPayment({ pelecardEnabled: false });
    const button = screen.getByRole("button", { name: /פלאקארד/s });
    expect(button).toBeDisabled();
    expect(screen.getByText(/תשלום פלאקארד אינו זמין לסל זה/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(props.onPelecard).not.toHaveBeenCalled();
  });

  test("disables only the verified provider action while initiation is running", () => {
    renderPayment({ pelecardBusy: true });
    expect(screen.getByRole("button", { name: /פלאקארד/s })).toBeDisabled();
    expect(screen.getByRole("button", { name: /אשראי.*חיצוני/s })).toBeEnabled();
  });
});
