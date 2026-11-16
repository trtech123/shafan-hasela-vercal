// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'admin', invoke: vi.fn(), order: vi.fn(), physical: vi.fn(), direct: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('react-router-dom', () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a> }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { functions: { invoke: state.invoke },
  from: () => ({ select: () => ({ eq: () => ({ single: () => state.order() }) }) }) } }));
vi.mock('@/components/customers/OrderCustomerLink', () => ({ default: () => <p>customer link control</p> }));
vi.mock('@/payments/physical/client', () => ({ startHostedPhysical: (...args) => state.physical(...args),
  startDirectPhysical: (...args) => state.direct(...args) }));
import OrderCollection from './OrderCollection';

const orderId = '33333333-3333-4333-8333-333333333333';
const view = (paidMinor = 0) => ({ orderId, orderNumber: 'ORD-123', clientName: 'Group A',
  organization: 'Club', activityName: 'Climbing', participants: 10, totalMinor: 10000,
  paidMinor, balanceMinor: 10000 - paidMinor, quoteId: null, unresolvedPayment: false,
  collectionEnabled: { cash: true, check: true },
  billing: { kind: 'organization', name: 'Group A', identity: '123456789', email: 'group@example.com' },
  payments: paidMinor ? [{ id: 'p1', status: 'succeeded', amountMinor: paidMinor }] : [], documents: [] });
afterEach(() => { cleanup(); state.invoke.mockReset(); state.order.mockReset(); state.physical.mockReset(); state.direct.mockReset(); state.role = 'admin'; vi.unstubAllEnvs(); localStorage.clear(); });

test('scheduled order shows saved total and balance without creating a cart', async () => {
  state.invoke.mockResolvedValue({ data: view(2000), error: null });
  render(<OrderCollection orderId={orderId} />);
  expect(await screen.findByText(/ORD-123/)).toBeInTheDocument();
  expect(screen.getByText('100.00 ₪')).toBeInTheDocument();
  expect(screen.getByText('20.00 ₪')).toBeInTheDocument();
  expect(screen.getByText('80.00 ₪')).toBeInTheDocument();
  expect(state.invoke).toHaveBeenCalledWith('payper-noncard-collection',
    { body: { action: 'status', orderId } });
});

test('keeps an uncertain physical intent on its recovery link', async () => {
  vi.stubEnv('VITE_PELECARD_PHYSICAL_ENABLED', 'true');
  state.invoke.mockResolvedValue({ data: { ...view(2000), unresolvedPayment: true }, error: null });
  render(<OrderCollection orderId={orderId} />);
  const link = await screen.findByRole('link', { name: /מסופון פיזי/ });
  expect(link).toHaveAttribute('href', `/payment/physical?orderId=${orderId}`);
});

test('eligible saved order starts hosted EMV directly for the server balance', async () => {
  vi.stubEnv('VITE_PELECARD_PHYSICAL_ENABLED', 'true');
  state.invoke.mockResolvedValue({ data: view(2000), error: null });
  state.physical.mockResolvedValue({ state: 'pending', route: 'hosted',
    redirectUrl: 'https://gateway21.pelecard.biz/PaymentGW?transactionId=22222222-2222-4222-8222-222222222222' });
  render(<OrderCollection orderId={orderId} />);
  fireEvent.click(await screen.findByRole('button', { name: /שלם במסופון פיזי/ }));
  await waitFor(() => expect(state.physical).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    orderId, amountMinor: 8000, requestKey: expect.any(String) })));
  expect(screen.queryByRole('link', { name: /תשלום במסופון פיזי להזמנה זו/ })).toBeNull();
});

test('direct activation sends scheduled order to the queue without opening hosted EMV', async () => {
  vi.stubEnv('VITE_PELECARD_PHYSICAL_ENABLED', 'true');
  vi.stubEnv('VITE_PELECARD_PHYSICAL_DIRECT_ENABLED', 'true');
  state.invoke.mockResolvedValue({ data: view(), error: null });
  state.direct.mockResolvedValue({ state: 'reserved', route: 'direct', amountMinor: 10000,
    paymentId: '11111111-1111-4111-8111-111111111111', registerNumber: '004' });
  render(<OrderCollection orderId={orderId} />);
  fireEvent.click(await screen.findByRole('button', { name: /שלם במסופון פיזי/ }));
  await waitFor(() => expect(state.direct).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    orderId, amountMinor: 10000, requestKey: expect.any(String) })));
  expect(state.physical).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('pelecard.physicalPending.v1'))).toMatchObject({ mode: 'direct', orderId });
});

test('keeps the physical order link hidden while the browser gate is off', async () => {
  vi.stubEnv('VITE_PELECARD_PHYSICAL_ENABLED', 'false');
  state.invoke.mockResolvedValue({ data: view(), error: null });
  render(<OrderCollection orderId={orderId} />);
  await screen.findByText(/ORD-123/);
  expect(screen.queryByRole('link', { name: /מסופון פיזי/ })).toBeNull();
});

test('shows the balance but disables cash and check collection while document dispatch is off', async () => {
  state.invoke.mockResolvedValue({ data: { ...view(), collectionEnabled: { cash: false, check: false } }, error: null });
  render(<OrderCollection orderId={orderId} />);
  expect(await screen.findByText(/גבייה במזומן ובהמחאה אינה פעילה/)).toBeInTheDocument();
  expect(screen.getAllByText('100.00 ₪')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /רשום תשלום והפק מסמך/ })).toBeNull();
});

test('keeps existing digital order checkout available when non-card gates are off', async () => {
  state.invoke.mockResolvedValue({ data: { ...view(), collectionEnabled: { cash: false, check: false } }, error: null });
  render(<OrderCollection orderId={orderId} />);
  expect(await screen.findByRole('button', { name: /שלם באשראי דיגיטלי/ })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /רשום תשלום והפק מסמך/ })).toBeNull();
});

test('does not offer full-total digital checkout after an order has a partial payment', async () => {
  state.invoke.mockResolvedValue({ data: { ...view(2000), collectionEnabled: { cash: false, check: false } }, error: null });
  render(<OrderCollection orderId={orderId} />);
  await screen.findByText(/ORD-123/);
  expect(screen.queryByRole('button', { name: /שלם באשראי דיגיטלי/ })).toBeNull();
});

test('cashier sees the server-computed full balance', async () => {
  state.role = 'קופאי';
  state.invoke.mockResolvedValue({ data: view(), error: null });
  render(<OrderCollection orderId={orderId} />);
  const amount = await screen.findByLabelText('סכום לגבייה (₪)');
  expect(amount).toHaveAttribute('readonly');
  expect(amount).toHaveValue(100);
});

test('paid cash order shows its issued invoice and no obsolete billing warning', async () => {
  state.invoke.mockResolvedValue({ data: { ...view(10000), billingIssues: ['billing_email_required'],
    accountingReviewRequired: true,
    documents: [{ paymentId: 'p1', state: 'succeeded', documentNumber: '200004',
      documentUrl: 'https://app.payper.co.il/public/invoice_show/3630819?ak=opaqueproviderkey123' }] }, error: null });
  render(<OrderCollection orderId={orderId} />);
  expect(await screen.findByText(/ORD-123/)).toBeInTheDocument();
  expect(screen.getByText(/הופק 200004/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'פתיחה והדפסה' })).toHaveAttribute('href',
    'https://app.payper.co.il/public/invoice_show/3630819?ak=opaqueproviderkey123');
  expect(screen.queryByText(/לפני גבייה במזומן/)).toBeNull();
  expect(screen.queryByText(/גבייה נוספת חסומה/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'השלמת פרטי חיוב להזמנה זו' })).toBeNull();
});

test('an uncertain cash invoice result asks for matching the existing document, not issuance approval', async () => {
  state.invoke.mockImplementation((_name, { body }) => Promise.resolve({ data:
    body.action === 'status' ? { ...view(10000), documents: [{ paymentId: 'p1',
      state: 'reconciliation_required', code: 'provider_response_uncertain' }] }
      : { saleId: 'sale-1', paymentId: 'p1', receiptNumber: 'RCP-1045',
        accounting: { state: 'reconciliation_required' } }, error: null }));
  render(<OrderCollection orderId={orderId} />);
  await screen.findByText(/ORD-123/);
  expect(screen.getByText(/נדרשת התאמה/)).toBeInTheDocument();
  expect(screen.queryByText(/טרם אושר להפקה/)).toBeNull();
});

test('cash result follows refreshed ledger after an uncertain response is reconciled', async () => {
  let statusChecks = 0;
  state.invoke.mockImplementation((_name, { body }) => Promise.resolve({ data:
    body.action === 'status' ? (statusChecks++ === 0 ? view() : { ...view(10000),
      documents: [{ paymentId: 'p1', state: 'succeeded', documentNumber: '200004',
        documentUrl: 'https://app.payper.co.il/public/invoice_show/3630819?ak=opaqueproviderkey123' }] })
      : { saleId: 'sale-1', paymentId: 'p1', receiptNumber: 'RCP-1045',
        accounting: { state: 'reconciliation_required' } }, error: null }));
  render(<OrderCollection orderId={orderId} />);
  await screen.findByLabelText('סכום לגבייה (₪)');
  fireEvent.change(screen.getByLabelText('אמצעי תשלום'), { target: { value: 'cash' } });
  fireEvent.click(screen.getByRole('button', { name: 'רשום תשלום והפק מסמך' }));
  expect(await screen.findByText(/מסמך Payper רשמי 200004/)).toBeInTheDocument();
  expect(screen.queryByText(/טרם אושר להפקה/)).toBeNull();
  expect(state.invoke.mock.calls.filter(([, arg]) => arg.body.action === 'collect')).toHaveLength(1);
});

test('admin cash collection uses the order ID and full balance exactly once', async () => {
  state.invoke.mockImplementation((_name, { body }) => Promise.resolve({
    data: body.action === 'status' ? view() : { saleId: 'sale-1', paymentId: 'payment-1',
      receiptNumber: 'RCP-2000', accounting: { state: 'source_frozen' } }, error: null,
  }));
  render(<OrderCollection orderId={orderId} />);
  await screen.findByLabelText('סכום לגבייה (₪)');
  fireEvent.change(screen.getByLabelText('אמצעי תשלום'), { target: { value: 'cash' } });
  fireEvent.click(screen.getByText('רשום תשלום והפק מסמך'));
  await waitFor(() => expect(state.invoke).toHaveBeenCalledWith('payper-noncard-collection',
    { body: expect.objectContaining({ action: 'collect', orderId, method: 'cash', amountMinor: 10000,
      documentType: 'invoice-receipt',
      requestKey: expect.any(String) }) }));
  expect(state.invoke.mock.calls.filter(([, arg]) => arg.body.action === 'collect')).toHaveLength(1);
});

test('missing VAT blocks cash collection and offers same-order customer linking', async () => {
  state.invoke.mockResolvedValue({ data: { ...view(), billingIssues: ['vat_required'] }, error: null });
  state.order.mockResolvedValue({ data: { id: orderId }, error: null });
  render(<OrderCollection orderId={orderId} />);
  expect(await screen.findByRole('button', { name: 'רשום תשלום והפק מסמך' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'השלמת פרטי חיוב להזמנה זו' }));
  expect(await screen.findByText('customer link control')).toBeInTheDocument();
  expect(state.invoke.mock.calls.filter(([, arg]) => arg.body.action === 'collect')).toHaveLength(0);
});
