// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'admin', invoke: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('react-router-dom', () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a> }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { functions: { invoke: state.invoke } } }));
import OrderCollection from './OrderCollection';

const orderId = '33333333-3333-4333-8333-333333333333';
const view = (paidMinor = 0) => ({ orderId, orderNumber: 'ORD-123', clientName: 'Group A',
  organization: 'Club', activityName: 'Climbing', participants: 10, totalMinor: 10000,
  paidMinor, balanceMinor: 10000 - paidMinor, quoteId: null, unresolvedPayment: false,
  billing: { kind: 'organization', name: 'Group A', identity: '123456789', email: 'group@example.com' },
  payments: paidMinor ? [{ id: 'p1', status: 'succeeded', amountMinor: paidMinor }] : [], documents: [] });
afterEach(() => { cleanup(); state.invoke.mockReset(); state.role = 'admin'; vi.unstubAllEnvs(); });

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

test('offers physical terminal payment for the saved order and keeps its link available for uncertain recovery', async () => {
  vi.stubEnv('VITE_PELECARD_PHYSICAL_ENABLED', 'true');
  state.invoke.mockResolvedValue({ data: { ...view(2000), unresolvedPayment: true }, error: null });
  render(<OrderCollection orderId={orderId} />);
  const link = await screen.findByRole('link', { name: /מסופון פיזי/ });
  expect(link).toHaveAttribute('href', `/payment/physical?orderId=${orderId}`);
});

test('keeps the physical order link hidden while the browser gate is off', async () => {
  vi.stubEnv('VITE_PELECARD_PHYSICAL_ENABLED', 'false');
  state.invoke.mockResolvedValue({ data: view(), error: null });
  render(<OrderCollection orderId={orderId} />);
  await screen.findByText(/ORD-123/);
  expect(screen.queryByRole('link', { name: /מסופון פיזי/ })).toBeNull();
});

test('cashier cannot enter a partial payment', async () => {
  state.role = 'קופאי';
  state.invoke.mockResolvedValue({ data: view(), error: null });
  render(<OrderCollection orderId={orderId} />);
  const amount = await screen.findByLabelText('סכום לגבייה (₪)');
  expect(amount).toBeDisabled();
  expect(amount).toHaveValue(100);
});

test('admin cash collection uses the order ID and requested partial amount exactly once', async () => {
  state.invoke.mockImplementation((_name, { body }) => Promise.resolve({
    data: body.action === 'status' ? view() : { saleId: 'sale-1', paymentId: 'payment-1',
      receiptNumber: 'RCP-2000', accounting: { state: 'source_frozen' } }, error: null,
  }));
  render(<OrderCollection orderId={orderId} />);
  fireEvent.change(await screen.findByLabelText('סכום לגבייה (₪)'), { target: { value: '25.00' } });
  fireEvent.change(screen.getByLabelText('אמצעי תשלום'), { target: { value: 'cash' } });
  fireEvent.click(screen.getByText('רשום תשלום והפק מסמך'));
  await waitFor(() => expect(state.invoke).toHaveBeenCalledWith('payper-noncard-collection',
    { body: expect.objectContaining({ action: 'collect', orderId, method: 'cash', amountMinor: 2500,
      requestKey: expect.any(String) }) }));
  expect(state.invoke.mock.calls.filter(([, arg]) => arg.body.action === 'collect')).toHaveLength(1);
});
