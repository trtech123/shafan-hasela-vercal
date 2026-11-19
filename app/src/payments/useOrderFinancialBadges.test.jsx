// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc } }));

import { useOrderFinancialBadges } from './useOrderFinancialBadges';

afterEach(() => rpc.mockReset());

test('refreshes the verified balance when an existing order is reloaded', async () => {
  const orderId = '00000000-0000-4000-8000-000000000001';
  rpc.mockResolvedValueOnce({ data: [{ orderId, state: 'unpaid',
    totalMinor: 100, paidMinor: 0, balanceMinor: 100 }], error: null });
  rpc.mockResolvedValueOnce({ data: [{ orderId, state: 'paid',
    totalMinor: 100, paidMinor: 100, balanceMinor: 0 }], error: null });

  const { result, rerender } = renderHook(({ orders }) => useOrderFinancialBadges(orders), {
    initialProps: { orders: [{ id: orderId, payment_status: 'לא שולם' }] },
  });
  await waitFor(() => expect(result.current[orderId]?.state).toBe('unpaid'));

  rerender({ orders: [{ id: orderId, payment_status: 'פלאקארד' }] });
  await waitFor(() => expect(result.current[orderId]?.state).toBe('paid'));
  expect(rpc).toHaveBeenCalledTimes(2);
});
