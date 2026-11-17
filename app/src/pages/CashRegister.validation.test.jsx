// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ invoke: vi.fn(), navigate: vi.fn(), role: 'admin',
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role, id: state.userId } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ search: '' }), useNavigate: () => state.navigate,
}));
vi.mock('@/api/supabaseClient', () => ({ supabase: {
  from: table => ({ select: () => ({ eq: async () => ({ data: table === 'products'
    ? []
    : [{ id: '22222222-2222-4222-8222-222222222222', name: 'המרוץ למטמון – סדנת גיבוש', price_per_person: 180, status: 'פעיל' }], error: null }) }) }),
  functions: { invoke: (...args) => state.invoke(...args) },
} }));
vi.mock('@/components/cashregister/LinkOrderSearch', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import CashRegister from './CashRegister';

afterEach(() => { cleanup(); state.invoke.mockReset(); state.navigate.mockReset(); sessionStorage.clear();
  state.role = 'admin'; state.userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; });

function completeDigitalBilling() {
  const dialog = screen.getByRole('dialog', { name: 'פרטי חיוב לתשלום דיגיטלי' });
  fireEvent.change(screen.getByLabelText('שם לחיוב'), { target: { value: 'Test Customer' } });
  fireEvent.change(screen.getByLabelText('מספר זהות / חברה'), { target: { value: '123456782' } });
  fireEvent.change(screen.getByLabelText('דוא״ל למסמך'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'המשך לפלאקארד' }));
  expect(dialog).not.toBeInTheDocument();
}

test('standalone cashier shows a 422 rejection for the reported activity after the real cart and Pay controls', async () => {
  state.invoke.mockImplementation(async (name) => name === 'payper-noncard-collection'
    ? { data: { collectionEnabled: { cash: true, check: false } }, error: null }
    : { data: null, error: { context: new Response(JSON.stringify({ error: { code: 'catalog_item_unavailable' } }), { status: 422 }) } });

  render(<CashRegister />);
  fireEvent.click(await screen.findByRole('button', { name: /המרוץ למטמון/ }));
  fireEvent.click(screen.getByRole('button', { name: /המשך לתשלום/ }));
  fireEvent.click(screen.getByRole('button', { name: /פלאקארד — תשלום מאומת/ }));
  fireEvent.click(screen.getByTestId('cashier-pay'));
  completeDigitalBilling();

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('המוצר או השירות אינו פעיל בקטלוג'));
  expect(state.invoke).toHaveBeenCalledWith('pelecard-pos-payment', expect.objectContaining({
    body: expect.objectContaining({ action: 'prepare', lines: [{ kind: 'service', id: '22222222-2222-4222-8222-222222222222', qty: 1 }], discount: null,
      billing: { kind: 'person', name: 'Test Customer', identity: '123456782', email: 'test@example.com' } }),
  }));
  expect(state.invoke.mock.calls.filter(([name]) => name === 'pelecard-pos-payment')).toHaveLength(1);
  expect(state.navigate).not.toHaveBeenCalled();
  expect(screen.getByTestId('cashier-pay')).toHaveTextContent('שלם');
});

test('selected discount type with no amount pays the full ₪180 activity price without sending a zero discount', async () => {
  state.invoke.mockImplementation(async (name) => name === 'payper-noncard-collection'
    ? { data: { collectionEnabled: { cash: true, check: false } }, error: null }
    : { data: { mode: 'pos', paymentId: '33333333-3333-4333-8333-333333333333',
      amountMinor: 18000, currency: 'ILS', paid: false, status: 'pending_provider',
      dispatchStarted: true, canResume: false, redirectUrl: null, hostedExpiresAt: null,
      serverTime: new Date().toISOString() }, error: null });

  render(<CashRegister />);
  fireEvent.click(await screen.findByRole('button', { name: /המרוץ למטמון/ }));
  fireEvent.click(screen.getByRole('button', { name: 'הנחה כללית' }));
  expect(screen.getByRole('button', { name: 'הנחה כללית' })).toHaveClass('border-amber-500');
  expect(screen.getAllByText('180₪').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: /המשך לתשלום/ }));
  fireEvent.click(screen.getByRole('button', { name: /פלאקארד — תשלום מאומת/ }));
  fireEvent.click(screen.getByTestId('cashier-pay'));
  completeDigitalBilling();

  await waitFor(() => expect(state.invoke).toHaveBeenCalledWith('pelecard-pos-payment', expect.objectContaining({
    body: expect.objectContaining({ action: 'prepare', discount: null,
      lines: [{ kind: 'service', id: '22222222-2222-4222-8222-222222222222', qty: 1 }] }),
  })));
});

test('cashier account does not reuse a previous admin checkout reference for the same cart', async () => {
  const oldKey = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const cart = { lines: [{ kind: 'service', id: '22222222-2222-4222-8222-222222222222', qty: 1 }], discount: null };
  sessionStorage.setItem('pelecard.posPending.v1', JSON.stringify({ requestKey: oldKey, cart: JSON.stringify(cart) }));
  state.role = 'קופאי'; state.userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  state.invoke.mockImplementation(async (name, { body }) => name === 'payper-noncard-collection'
    ? { data: { collectionEnabled: { cash: true, check: false } }, error: null }
    : body.requestKey === oldKey
      ? { data: null, error: { context: new Response(JSON.stringify({ error: { code: 'request_key_conflict' } }), { status: 409 }) } }
      : { data: { mode: 'pos', paymentId: '33333333-3333-4333-8333-333333333333',
        amountMinor: 18000, currency: 'ILS', paid: false, status: 'pending_provider',
        dispatchStarted: true, canResume: false, redirectUrl: null, hostedExpiresAt: null,
        serverTime: new Date().toISOString() }, error: null });

  render(<CashRegister />);
  fireEvent.click(await screen.findByRole('button', { name: /המרוץ למטמון/ }));
  fireEvent.click(screen.getByRole('button', { name: /המשך לתשלום/ }));
  fireEvent.click(screen.getByRole('button', { name: /פלאקארד — תשלום מאומת/ }));
  fireEvent.click(screen.getByTestId('cashier-pay'));
  completeDigitalBilling();

  await waitFor(() => expect(state.invoke).toHaveBeenCalledWith('pelecard-pos-payment', expect.objectContaining({
    body: expect.objectContaining({ action: 'prepare', requestKey: expect.not.stringMatching(oldKey) }),
  })));
  expect(state.invoke.mock.calls.filter(([name]) => name === 'pelecard-pos-payment')).toHaveLength(1);
  expect(sessionStorage.getItem('pelecard.posPending.v1')).toContain(oldKey);
});

test('a conflicting checkout reference shows a Hebrew error in the cashier without false recovery navigation', async () => {
  state.invoke.mockImplementation(async name => name === 'payper-noncard-collection'
    ? { data: { collectionEnabled: { cash: true, check: false } }, error: null }
    : { data: null, error: { context: new Response(JSON.stringify({ error: { code: 'request_key_conflict' } }), { status: 409 }) } });
  render(<CashRegister />);
  fireEvent.click(await screen.findByRole('button', { name: /המרוץ למטמון/ }));
  fireEvent.click(screen.getByRole('button', { name: /המשך לתשלום/ }));
  fireEvent.click(screen.getByRole('button', { name: /פלאקארד — תשלום מאומת/ }));
  fireEvent.click(screen.getByTestId('cashier-pay'));
  completeDigitalBilling();

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('מזהה הסל כבר שייך לניסיון אחר'));
  expect(state.navigate).not.toHaveBeenCalled();
});
