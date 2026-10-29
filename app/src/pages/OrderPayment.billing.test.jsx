// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import OrderPayment from './OrderPayment';

const request = vi.fn();
const redirect = vi.fn();
let role = 'admin';
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));
vi.mock('@/payments/orderPayments', () => ({
  validOrderId: () => true,
  requestOrderPayment: (...args) => request(...args),
  redirectOrderPayment: (...args) => redirect(...args),
}));

const orderId = 'a0000000-0000-4000-8000-000000000001';
const status = { orderId, orderNumber: 'NEW-1', amountMinor: 11800, currency: 'ILS',
  paid: false, canInitialize: true, payment: null,
  billingDefaults: { kind: 'person', name: 'Test Customer', identity: '000000018', email: 'test@example.org' } };
function NextOrder() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/payment/order?orderId=b0000000-0000-4000-8000-000000000002')}>next order</button>;
}

beforeEach(() => { role = 'admin'; request.mockReset().mockResolvedValue(status); redirect.mockReset(); });
afterEach(cleanup);

describe('admin-assisted Pelecard billing step', () => {
  test('reviews existing identity before initializing without putting it in the URL', async () => {
    render(<MemoryRouter initialEntries={[`/payment/order?orderId=${orderId}`]}><OrderPayment /></MemoryRouter>);
    expect(await screen.findByRole('region', { name: 'פרטי חיוב לפני התשלום' })).toBeInTheDocument();
    expect(screen.getByLabelText('מספר תעודת זהות')).toHaveValue('000000018');
    fireEvent.click(screen.getByRole('button', { name: 'התחל תשלום באשראי' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'initialize', orderId, billing: status.billingDefaults,
    })));
    expect(window.location.search).not.toContain('000000018');
  });

  test('allows empty identity to reach the existing reservation request', async () => {
    render(<MemoryRouter initialEntries={[`/payment/order?orderId=${orderId}`]}><OrderPayment /></MemoryRouter>);
    const identity = await screen.findByLabelText('מספר תעודת זהות');
    fireEvent.change(identity, { target: { value: '' } });
    expect(screen.getByRole('note')).toHaveTextContent('בדיקה ידנית');
    fireEvent.click(screen.getByRole('button', { name: 'התחל תשלום באשראי' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'initialize', billing: expect.objectContaining({ identity: '' }),
    })));
  });

  test('cashier can review billing and initiate order payment', async () => {
    role = 'קופאי';
    render(<MemoryRouter initialEntries={[`/payment/order?orderId=${orderId}`]}><OrderPayment /></MemoryRouter>);
    expect(await screen.findByRole('region', { name: 'פרטי חיוב לפני התשלום' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'התחל תשלום באשראי' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'initialize' })));
  });

  test('shift manager cannot load billing or initiate payment', async () => {
    role = 'אחמ"ש';
    render(<MemoryRouter initialEntries={[`/payment/order?orderId=${orderId}`]}><OrderPayment /></MemoryRouter>);
    expect(screen.queryByRole('region', { name: 'פרטי חיוב לפני התשלום' })).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  test('does not reuse a previous order identity when a new order has no defaults', async () => {
    request.mockImplementation(async (_client, body) => body.orderId === orderId
      ? status : { ...status, orderId: body.orderId, billingDefaults: null });
    render(<MemoryRouter initialEntries={[`/payment/order?orderId=${orderId}`]}><NextOrder /><OrderPayment /></MemoryRouter>);
    expect(await screen.findByLabelText('מספר תעודת זהות')).toHaveValue('000000018');
    fireEvent.click(screen.getByRole('button', { name: 'next order' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ action: 'status', orderId: 'b0000000-0000-4000-8000-000000000002' })));
    expect(await screen.findByLabelText('מספר תעודת זהות')).toHaveValue('');
  });
});
