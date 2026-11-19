// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
afterEach(() => { cleanup(); vi.useRealTimers(); });

test('a stalled status request ends with clear Hebrew guidance and never initializes', async () => {
  vi.useFakeTimers();
  state.request.mockImplementation(() => new Promise(() => {}));
  render(<OrderDigitalCheckout orderId={orderId} balanceMinor={1500} />);
  fireEvent.click(screen.getByRole('button', { name: 'שלם באשראי דיגיטלי' }));
  expect(screen.getByRole('button', { name: 'בודק וממשיך לתשלום…' })).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(20001); });
  expect(screen.getByRole('alert')).toHaveTextContent('בדיקת התשלום מתעכבת');
  expect(state.request.mock.calls.filter(([, body]) => body.action === 'initialize')).toHaveLength(0);
});

test('a stalled initialization requires review and cannot launch a second attempt', async () => {
  vi.useFakeTimers();
  state.request.mockImplementation((_client, body) => body.action === 'status'
    ? Promise.resolve(base) : new Promise(() => {}));
  render(<OrderDigitalCheckout orderId={orderId} balanceMinor={1500} />);
  fireEvent.click(screen.getByRole('button', { name: 'שלם באשראי דיגיטלי' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(30001); });
  expect(screen.getByRole('alert')).toHaveTextContent('ניסיון התשלום עשוי להיות פעיל');
  expect(screen.getByRole('button', { name: 'שלם באשראי דיגיטלי' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'בדיקת ניסיון התשלום הקיים' })).toBeInTheDocument();
  expect(state.request.mock.calls.filter(([, body]) => body.action === 'initialize')).toHaveLength(1);
});

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

test('linked customer email clears billing review and continues direct digital checkout', async () => {
  let linked = false;
  const onStatus = vi.fn(() => { linked = true; });
  state.request.mockImplementation(async (_client, body) => body.action === 'status'
    ? linked ? base : { ...base, billingDefaults: { ...defaults, email: '' },
      eligibilityIssues: ['billing_email_required'] }
    : { ...base, payment: { canResume: true },
      redirectUrl: 'https://gateway20.pelecard.biz/PaymentGW?transactionId=11111111-1111-4111-8111-111111111111',
      hostedDeadlineMs: performance.now() + 60000 });
  render(<OrderDigitalCheckout orderId={orderId} balanceMinor={1500} onStatus={onStatus} />);
  fireEvent.click(screen.getByRole('button', { name: 'שלם באשראי דיגיטלי' }));
  fireEvent.click(await screen.findByRole('button', { name: 'save billing' }));
  expect(onStatus).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'שלם באשראי דיגיטלי' }));
  await waitFor(() => expect(state.redirect).toHaveBeenCalledTimes(1));
  expect(state.request.mock.calls.filter(([, body]) => body.action === 'initialize')).toHaveLength(1);
  expect(state.request.mock.calls.at(-1)[1].billing).toEqual(defaults);
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

test('stale cashier state cannot initialize after an unresolved attempt appears on the server', async () => {
  state.request.mockResolvedValue({ ...base, canInitialize: false,
    payment: { id: 'c0000000-0000-4000-8000-000000000002',
      status: 'pending_provider', canResume: false } });
  render(<OrderDigitalCheckout orderId={orderId} balanceMinor={1500} />);
  fireEvent.click(screen.getByRole('button', { name: 'שלם באשראי דיגיטלי' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('קיים ניסיון תשלום'));
  expect(state.request.mock.calls.map(([, body]) => body.action)).toEqual(['status']);
  expect(state.redirect).not.toHaveBeenCalled();
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
