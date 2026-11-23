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
  test("does not offer external credit as a new payment", () => {
    const props = renderPayment();
    expect(screen.queryByRole("button", { name: /אשראי.*חיצוני/s })).not.toBeInTheDocument();
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onPelecard).not.toHaveBeenCalled();
  });

  test("keeps other receipt-only tenders unavailable", () => {
    const props = renderPayment();
    for (const name of [/העברה בנקאית/s, /ביט \/ Paybox/s, /חשבונית \/ חח״ד/s, /תשלום מפוצל/s]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  test("a role newly admitted for physical payment cannot use legacy manual sale methods", () => {
    const props = renderPayment({ manualMethodsEnabled: false, noncardEnabled: { cash: false, check: false } });
    expect(screen.queryByRole("button", { name: /אשראי.*חיצוני/s })).not.toBeInTheDocument();
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

  test('accepts invoice billing without a registered customer', () => {
    const props = renderPayment({ pelecardEnabled: true });
    fireEvent.click(screen.getByRole('button', { name: /פלאקארד/s }));
    fireEvent.click(screen.getByTestId('cashier-pay'));
    expect(screen.getByText(/אין צורך לבחור או לפתוח כרטיס לקוח בקופה/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('שם לחיוב'), { target: { value: 'Walk-in Customer' } });
    fireEvent.change(screen.getByLabelText('מספר זהות / חברה'), { target: { value: '123456782' } });
    fireEvent.change(screen.getByLabelText('דוא״ל למסמך'), { target: { value: 'walkin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'המשך לפלאקארד' }));
    expect(props.onPelecard).toHaveBeenCalledWith({ kind: 'person', name: 'Walk-in Customer',
      identity: '123456782', email: 'walkin@example.com' });
  });

  test("does not offer hosted payment for an ineligible cart", () => {
    const props = renderPayment({ pelecardEnabled: false });
    const button = screen.getByRole("button", { name: /פלאקארד/s });
    expect(button).toBeDisabled();
    expect(screen.getByText(/תשלום פלאקארד אינו זמין לסל זה/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(props.onPelecard).not.toHaveBeenCalled();
  });

  test("disables the verified provider action while initiation is running", () => {
    renderPayment({ pelecardBusy: true });
    expect(screen.getByRole("button", { name: /פלאקארד/s })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /אשראי.*חיצוני/s })).not.toBeInTheDocument();
  });
});
