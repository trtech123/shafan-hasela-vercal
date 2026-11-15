// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ request: vi.fn(), redirect: vi.fn(), order: vi.fn() }));
vi.mock('@/payments/orderPayments', () => ({
  requestOrderPayment: (...args) => state.request(...args),
  redirectOrderPayment: (...args) => state.redirect(...args),
}));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: () => ({
  select: () => ({ eq: () => ({ single: () => state.order() }) }),
}) } }));
vi.mock('@/components/customers/OrderCustomerLink', () => ({ default: ({ onLinked }) =>
  <button onClick={() => onLinked({ id: 'order', vat_applicable: true })}>save billing</button> }));
import OrderDigitalCheckout from './OrderDigitalCheckout';

const orderId = '33333333-3333-4333-8333-333333333333';
const defaults = { kind: 'person', name: 'Daniel Test', identity: '000000018', email: 'daniel@example.org' };
const base = { mode: 'live', orderId, paid: false, canInitialize: true, amountMinor: 1500,
  billingDefaults: defaults, eligibilityIssues: [], payment: null };
beforeEach(() => { state.request.mockReset(); state.redirect.mockReset(); state.order.mockReset()
  .mockResolvedValue({ data: { id: orderId, payment_status: 'לא שולם' }, error: null }); });
afterEach(cleanup);

test('eligible scheduled order initializes once for the server balance and redirects', async () => {
  state.request.mockImplementation(async (_client, body) => body.action === 'status' ? base : {
    ...base, payment: { canResume: true },
    redirectUrl: 'https://gateway20.pelecard.biz/PaymentGW?transactionId=11111111-1111-4111-8111-111111111111',
    hostedDeadlineMs: performance.now() + 60000,
  });
  render(<OrderDigitalCheckout orderId={orderId} balanceMinor={1500} />);
  fireEvent.click(screen.getByRole('button', { name: 'שלם באשראי דיגיטלי' }));
  await waitFor(() => expect(state.redirect).toHaveBeenCalledTimes(1));
  expect(state.request.mock.calls[1][1]).toEqual({ action: 'initialize', orderId,
    expectedAmountMinor: 1500, previousPaymentId: null, billing: defaults });
});

test('missing VAT opens billing dialog and never initializes', async () => {
  state.request.mockResolvedValue({ ...base, canInitialize: false, billingDefaults: null,
    eligibilityIssues: ['vat_required'] });
  render(<OrderDigitalCheckout orderId={orderId} balanceMinor={1500} />);
  fireEvent.click(screen.getByRole('button', { name: 'שלם באשראי דיגיטלי' }));
  expect(await screen.findByText('השלמת פרטי חיוב להזמנה')).toBeInTheDocument();
  expect(screen.getByText(/יש לקבוע מדיניות מע״מ/)).toBeInTheDocument();
  expect(state.request.mock.calls.filter(([, body]) => body.action === 'initialize')).toHaveLength(0);
});

test('stale visible balance cannot initialize a charge', async () => {
  state.request.mockResolvedValue({ ...base, amountMinor: 1400 });
  render(<OrderDigitalCheckout orderId={orderId} balanceMinor={1500} />);
  fireEvent.click(screen.getByRole('button', { name: 'שלם באשראי דיגיטלי' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('יתרת ההזמנה השתנתה'));
  expect(state.request.mock.calls.filter(([, body]) => body.action === 'initialize')).toHaveLength(0);
});

test('historical partial payment stays blocked even if billing is also missing', async () => {
  state.request.mockResolvedValue({ ...base, canInitialize: false, billingDefaults: null,
    eligibilityIssues: ['digital_partial_unsupported', 'vat_required'] });
  render(<OrderDigitalCheckout orderId={orderId} balanceMinor={1500} />);
  fireEvent.click(screen.getByRole('button', { name: 'שלם באשראי דיגיטלי' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('גבייה קודמת'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(state.request.mock.calls.filter(([, body]) => body.action === 'initialize')).toHaveLength(0);
});
