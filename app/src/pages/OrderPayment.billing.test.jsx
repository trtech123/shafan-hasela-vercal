// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import OrderPayment from './OrderPayment';

const request = vi.fn();
let role = 'admin';
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));
vi.mock('@/payments/orderPayments', () => ({
  validOrderId: () => true,
  requestOrderPayment: (...args) => request(...args),
  redirectOrderPayment: vi.fn(),
}));

const orderId = 'a0000000-0000-4000-8000-000000000001';
const status = { orderId, orderNumber: 'NEW-1', amountMinor: 11800, currency: 'ILS',
  paid: false, canInitialize: true, payment: null,
  billingDefaults: { kind: 'person', name: 'Test Customer', identity: '000000018', email: 'test@example.org' } };

beforeEach(() => { role = 'admin'; request.mockReset().mockResolvedValue(status); });
afterEach(cleanup);

test('legacy order preparation URL returns cashier to the existing order without initializing', async () => {
  render(<MemoryRouter initialEntries={[`/payment/order?orderId=${orderId}`]}>
    <Routes><Route path="/payment/order" element={<OrderPayment />} />
      <Route path="/cashregister" element={<p>cashier collection</p>} /></Routes>
  </MemoryRouter>);
  expect(await screen.findByText('cashier collection')).toBeInTheDocument();
  expect(request.mock.calls.filter(([, body]) => body.action === 'initialize')).toHaveLength(0);
});

test('legacy URL with missing VAT also returns to cashier rather than showing an autofilled identity', async () => {
  request.mockResolvedValue({ ...status, canInitialize: false, billingDefaults: null,
    eligibilityIssues: ['vat_required'] });
  render(<MemoryRouter initialEntries={[`/payment/order?orderId=${orderId}`]}>
    <Routes><Route path="/payment/order" element={<OrderPayment />} />
      <Route path="/cashregister" element={<p>cashier collection</p>} /></Routes>
  </MemoryRouter>);
  expect(await screen.findByText('cashier collection')).toBeInTheDocument();
  expect(screen.queryByLabelText('שם מלא')).toBeNull();
});

test('shift manager cannot load billing or initiate payment on the legacy URL', () => {
  role = 'אחמ"ש';
  render(<MemoryRouter initialEntries={[`/payment/order?orderId=${orderId}`]}><OrderPayment /></MemoryRouter>);
  expect(request).not.toHaveBeenCalled();
});
