// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Dashboard from './Dashboard';
import { publishOrderChange } from '@/lib/orderEvents';

const mocks = vi.hoisted(() => ({ from: vi.fn(), is: vi.fn() }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: mocks.from } }));
vi.mock('../components/dashboard/StatsCard', () => ({
  default: ({ label, value }) => <div>{label}: {value}</div>,
}));
vi.mock('../components/dashboard/RecentOrders', () => ({
  default: ({ orders }) => <div data-testid="recent-orders">{orders.map(order => order.id).join(',')}</div>,
}));

beforeEach(() => {
  mocks.from.mockReset();
  mocks.is.mockReset();
  let orderQuery = 0;
  mocks.from.mockImplementation(table => {
    if (table === 'activities') return { select: () => Promise.resolve({ data: [], error: null }) };
    if (table !== 'orders') throw new Error(`Unexpected table: ${table}`);
    orderQuery += 1;
    if (orderQuery % 2 === 1) return {
      select: () => ({ order: () => ({ limit: () => Promise.resolve({
        data: [{ id: 'archived', status: 'שולם', total_price: 100, archived_at: '2026-11-04T10:00:00Z' }],
        error: null,
      }) }) }),
    };
    return {
      select: () => ({ is: (...args) => {
        mocks.is(...args);
        return { order: () => ({ limit: () => Promise.resolve({
          data: [{ id: 'active', status: 'ממתין לאישור', archived_at: null }], error: null,
        }) }) };
      } }),
    };
  });
});
afterEach(cleanup);

test('excludes archived orders from operational metrics and recents while preserving revenue', async () => {
  render(<Dashboard />);
  await waitFor(() => expect(screen.getByTestId('recent-orders')).toHaveTextContent('active'));
  expect(screen.getByTestId('recent-orders')).not.toHaveTextContent('archived');
  expect(screen.getByText('ממתינות לאישור: 1')).toBeInTheDocument();
  expect(screen.getByText('הכנסות (שולם): ₪100')).toBeInTheDocument();
  expect(mocks.is).toHaveBeenCalledWith('archived_at', null);
});

test('refreshes operational metrics after an order archive or restore event', async () => {
  render(<Dashboard />);
  await waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(3));
  publishOrderChange();
  await waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(6));
});
