// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import moment from 'moment';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ financial: 'paid', rpc: vi.fn() }));
const orderId = 'a0000000-0000-4000-8000-000000000002';
vi.mock('@/api/supabaseClient', () => ({ supabase: {
  from: (table) => {
    const query = { select: () => query, is: () => query, gte: () => query,
      lte: () => query, order: () => query, limit: () => query,
      then: resolve => resolve({ data: table === 'orders' ? [{ id: orderId,
        order_number: 'ORD-TEST', client_name: 'לקוח בדיקה',
        activity_date: moment().format('YYYY-MM-DD'), payment_status: 'לא שולם',
        status: 'מאושר', site: 'עכו', num_participants: 1 }] : [], error: null }),
    };
    return query;
  },
  rpc: (...args) => state.rpc(...args),
} }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
vi.mock('@/lib/holidays', async original => ({ ...(await original()),
  fetchHebcalYear: async () => [] }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('../components/schedule/BlockSlotDialog', () => ({ default: () => null }));

import Schedule from './Schedule';
afterEach(() => { cleanup(); state.rpc.mockReset(); });

test.each([
  ['paid', 'התשלום בוצע', false],
  ['review', 'תשלום בבדיקה', false],
  ['partial', 'שולם חלקית', true],
])('schedule action follows verified %s status', async (financial, label, collect) => {
  state.rpc.mockResolvedValue({ data: [{ orderId, state: financial, totalMinor: 100,
    paidMinor: financial === 'paid' ? 100 : 0,
    balanceMinor: financial === 'paid' ? 0 : 100 }], error: null });
  render(<MemoryRouter><Schedule /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: moment().format('YYYY-MM-DD') }));
  await waitFor(() => expect(screen.getByText(`תשלום: ${label}`)).toBeInTheDocument());
  const links = screen.queryAllByRole('link', { name: 'גבייה בקופה' });
  expect(links).toHaveLength(collect ? 1 : 0);
});
