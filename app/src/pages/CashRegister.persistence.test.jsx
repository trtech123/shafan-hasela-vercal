// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const failure = vi.hoisted(() => ({ toast: vi.fn(), insert: vi.fn(), invoke: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ search: '' }), useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: failure.toast } }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { functions: { invoke: failure.invoke }, from: table => ({
  select: () => ({ eq: async () => ({ data: table === 'products' ? [{ id: '11111111-1111-4111-8111-111111111111', name: 'Water', price: 3, status: 'פעיל' }] : [], error: null }) }),
  insert: () => ({ select: () => ({ single: failure.insert }) }),
}) } }));
vi.mock('@/components/cashregister/ActivityGrid', () => ({ default: () => null }));
vi.mock('@/components/cashregister/ProductGrid', () => ({ default: ({ products, onAdd }) => <button onClick={() => onAdd(products[0])}>add product</button> }));
vi.mock('@/components/cashregister/Cart', () => ({ default: ({ onCheckout }) => <button onClick={onCheckout}>checkout</button> }));
vi.mock('@/components/cashregister/PaymentScreen', () => ({ default: ({ onConfirm, noncardEnabled }) => <><button data-ready={noncardEnabled.cash} onClick={() => onConfirm('מזומן', {
  billing: { kind: 'organization', name: 'Club', identity: '123456789', email: 'club@example.com' },
  document_type: 'invoice-receipt', reference_document_id: null,
})}>pay cash</button><button onClick={() => onConfirm('אשראי')}>bypass external UI</button><button onClick={() => onConfirm('unknown-credit')}>bypass unknown UI</button></> }));
vi.mock('@/components/cashregister/ReceiptScreen', () => ({ default: () => <div>receipt shown</div> }));
import CashRegister from './CashRegister';

afterEach(() => { cleanup(); failure.toast.mockReset(); failure.insert.mockReset(); failure.invoke.mockReset(); });
test('a failed accounting collection never shows a paid receipt or a fabricated reference', async () => {
  failure.invoke.mockImplementation((_name, { body }) => Promise.resolve(body.action === 'capabilities'
    ? { data: { collectionEnabled: { cash: true, check: false } }, error: null }
    : { data: null, error: new Error('db unavailable') }));
  render(<CashRegister />);
  fireEvent.click(await screen.findByText('מוצרים'));
  fireEvent.click(await screen.findByText('add product'));
  fireEvent.click(screen.getByText('checkout'));
  await waitFor(() => expect(screen.getByText('pay cash')).toHaveAttribute('data-ready', 'true'));
  fireEvent.click(screen.getByText('pay cash'));
  await waitFor(() => expect(failure.toast).toHaveBeenCalledWith(expect.stringContaining('אינה ודאית')));
  expect(screen.queryByText('receipt shown')).not.toBeInTheDocument();
  expect(failure.insert).not.toHaveBeenCalled();
});

test('two rapid confirmations of one cash checkout submit one idempotent collection', async () => {
  let complete = (_result) => {};
  failure.invoke.mockImplementation((_name, { body }) => body.action === 'capabilities'
    ? Promise.resolve({ data: { collectionEnabled: { cash: true, check: false } }, error: null })
    : new Promise(resolve => { complete = resolve; }));
  render(<CashRegister />);
  fireEvent.click(await screen.findByText('מוצרים'));
  fireEvent.click(await screen.findByText('add product'));
  fireEvent.click(screen.getByText('checkout'));
  await waitFor(() => expect(screen.getByText('pay cash')).toHaveAttribute('data-ready', 'true'));
  fireEvent.click(screen.getByText('pay cash'));
  fireEvent.click(screen.getByText('pay cash'));
  expect(failure.invoke).toHaveBeenCalledTimes(2);
  expect(failure.invoke).toHaveBeenCalledWith('payper-noncard-collection', {
    body: expect.objectContaining({ method: 'cash', documentType: 'invoice-receipt',
      requestKey: expect.any(String) }),
  });
  complete({ data: { receiptNumber: 'RCP-1023', accounting: { state: 'source_frozen' } }, error: null });
  expect(await screen.findByText('receipt shown')).toBeInTheDocument();
  expect(failure.insert).not.toHaveBeenCalled();
});

test('direct callback cannot create an unverified external credit sale', async () => {
  failure.invoke.mockResolvedValue({ data: { collectionEnabled: { cash: false, check: false } }, error: null });
  render(<CashRegister />);
  fireEvent.click(await screen.findByText('מוצרים'));
  fireEvent.click(await screen.findByText('add product'));
  fireEvent.click(screen.getByText('checkout'));
  fireEvent.click(screen.getByText('bypass external UI'));
  expect(failure.insert).not.toHaveBeenCalled();
  expect(screen.queryByText('receipt shown')).not.toBeInTheDocument();
});

test('unknown tender callback cannot create a receipt-only sale', async () => {
  failure.invoke.mockResolvedValue({ data: { collectionEnabled: { cash: false, check: false } }, error: null });
  render(<CashRegister />);
  fireEvent.click(await screen.findByText('מוצרים'));
  fireEvent.click(screen.getByText('add product'));
  fireEvent.click(screen.getByText('checkout'));
  fireEvent.click(screen.getByText('bypass unknown UI'));
  expect(failure.insert).not.toHaveBeenCalled();
});
