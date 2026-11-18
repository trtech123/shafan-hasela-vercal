// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import Vouchers from './Vouchers';

const state = vi.hoisted(() => ({ role: 'מדריך', from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...args) => state.from(...args), rpc: (...args) => state.rpc(...args) } }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal()), useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
afterEach(() => { cleanup(); state.from.mockReset(); state.rpc.mockReset(); });

test('instructors cannot read vouchers or start voucher actions', () => {
  render(<Vouchers />);
  expect(screen.getByRole('alert')).toHaveTextContent('אין הרשאה');
  expect(state.from).not.toHaveBeenCalled();
  expect(state.rpc).not.toHaveBeenCalled();
});
