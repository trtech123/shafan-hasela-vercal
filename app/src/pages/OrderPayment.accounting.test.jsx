// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import OrderPayment from './OrderPayment';

const request = vi.fn();
const invoke = vi.fn();
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { functions: { invoke: (...args) => invoke(...args) } } }));
vi.mock('@/payments/orderPayments', () => ({
  validOrderId: () => true,
  requestOrderPayment: (...args) => request(...args),
  redirectOrderPayment: vi.fn(),
}));

const orderId = 'a0000000-0000-4000-8000-000000000001';
const paymentId = 'a0000000-0000-4000-8000-000000000002';
const officialUrl = 'https://app.payper.co.il/public/invoice_show/123?ak=test';

beforeEach(() => {
  request.mockReset().mockResolvedValue({ orderId, orderNumber: 'ORD-1058', amountMinor: 1500,
    paid: true, accountingHeld: true, payment: { id: paymentId, status: 'succeeded', saleId: 'sale-1' } });
  invoke.mockReset().mockResolvedValue({ data: { documents: [{ paymentId, state: 'succeeded',
    documentNumber: '200003', documentUrl: officialUrl }] }, error: null });
});
afterEach(cleanup);

test('paid order shows its automatically issued Payper document despite the legacy accounting hold', async () => {
  render(<MemoryRouter initialEntries={[`/payment/order?orderId=${orderId}&review=1`]}><OrderPayment /></MemoryRouter>);
  const link = await screen.findByRole('link', { name: /מסמך Payper רשמי 200003/ },
    { timeout: 5000 });
  expect(link).toHaveAttribute('href', officialUrl);
  expect(screen.queryByText('לא יופק מסמך חשבונאי אוטומטי עבור תשלום זה.')).toBeNull();
  expect(invoke).toHaveBeenCalledWith('payper-noncard-collection', {
    body: { action: 'status', orderId },
  });
});
