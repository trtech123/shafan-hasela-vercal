// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const { rpc, auth } = vi.hoisted(() => ({
  rpc: vi.fn(async name => name === 'monthly_identified_payers'
    ? { data: [{ identified_customers: 1, unidentified_payments: 0 }], error: null }
    : { data: [{ day: '2026-11-01', site: 'עכו',
      register_number: '004', payment_method: 'אשראי', completed_count: 1,
      gross_amount: 15, refund_count: 0, refund_amount: 0 }], error: null }),
  auth: { user: { role: 'admin' } },
}));
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc } }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => auth }));
import MonthlyFinancialReport from './MonthlyFinancialReport';

afterEach(() => { cleanup(); rpc.mockClear(); auth.user = { role: 'admin' }; });

test('Admin sees completed payments from the read-only monthly RPC', async () => {
  render(<MonthlyFinancialReport />);
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('monthly_payment_report',
    expect.objectContaining({ p_site: null, p_register: null })));
  expect(await screen.findByText(/תשלומים שהושלמו:/)).toHaveTextContent('1');
  expect(screen.getByText(/לקוחות משלמים מזוהים/)).toBeInTheDocument();
});

test('Cashier cannot invoke the financial report', () => {
  auth.user = { role: 'קופאי' };
  render(<MonthlyFinancialReport />);
  expect(rpc).not.toHaveBeenCalled();
  expect(screen.queryByText('סיכום תשלומים חודשי')).not.toBeInTheDocument();
});
