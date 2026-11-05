// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const failure = vi.hoisted(() => ({ toast: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ search: '' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: failure.toast } }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: table => ({
  select: () => ({ eq: async () => ({ data: table === 'products' ? [{ id: '11111111-1111-4111-8111-111111111111', name: 'Water', price: 3, status: 'פעיל' }] : [], error: null }) }),
  insert: () => ({ select: () => ({ single: failure.insert }) }),
}) } }));
vi.mock('@/components/cashregister/ActivityGrid', () => ({ default: () => null }));
vi.mock('@/components/cashregister/ProductGrid', () => ({ default: ({ products, onAdd }) => <button onClick={() => onAdd(products[0])}>add product</button> }));
vi.mock('@/components/cashregister/Cart', () => ({ default: ({ onCheckout }) => <button onClick={onCheckout}>checkout</button> }));
vi.mock('@/components/cashregister/PaymentScreen', () => ({ default: ({ onConfirm }) => <button onClick={() => onConfirm('מזומן')}>pay cash</button> }));
vi.mock('@/components/cashregister/ReceiptScreen', () => ({ default: () => <div>receipt shown</div> }));
import CashRegister from './CashRegister';

afterEach(() => { cleanup(); failure.toast.mockReset(); failure.insert.mockReset(); });
test('a failed sale insert never shows a paid receipt or a fabricated reference', async () => {
  failure.insert.mockResolvedValue({ data: null, error: new Error('db unavailable') });
  render(<CashRegister />);
  fireEvent.click(await screen.findByText('מוצרים'));
  fireEvent.click(await screen.findByText('add product'));
  fireEvent.click(screen.getByText('checkout'));
  fireEvent.click(screen.getByText('pay cash'));
  await waitFor(() => expect(failure.toast).toHaveBeenCalledWith(expect.stringContaining('לא אושרה')));
  expect(screen.queryByText('receipt shown')).not.toBeInTheDocument();
});

test('two rapid confirmations of one manual checkout persist only one sale', async () => {
  let complete = (_result) => {};
  failure.insert.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<CashRegister />);
  fireEvent.click(await screen.findByText('מוצרים'));
  fireEvent.click(await screen.findByText('add product'));
  fireEvent.click(screen.getByText('checkout'));
  fireEvent.click(screen.getByText('pay cash'));
  fireEvent.click(screen.getByText('pay cash'));
  expect(failure.insert).toHaveBeenCalledTimes(1);
  complete({ data: { receipt_number: 'RCP-1023' }, error: null });
  expect(await screen.findByText('receipt shown')).toBeInTheDocument();
});
