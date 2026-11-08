// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ archiveFilter: vi.fn() }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: () => {
  const query = {
    select: () => query,
    is: (field, value) => { state.archiveFilter(field, value); return query; },
    or: () => query,
    order: () => query,
    limit: async () => ({ data: state.archiveFilter.mock.calls.length
      ? [{ id: 'active', client_name: 'לקוח פעיל', order_number: 'ORD-ACTIVE' }]
      : [{ id: 'archived', client_name: 'לקוח בארכיון', order_number: 'ORD-ARCHIVED' }], error: null }),
  };
  return query;
} } }));

import LinkOrderSearch from './LinkOrderSearch';
afterEach(() => { cleanup(); state.archiveFilter.mockClear(); });

test('cash register search excludes archived orders before offering a sale link', async () => {
  render(<LinkOrderSearch linkedOrder={null} onSelect={vi.fn()} onClear={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /קשר להזמנה/ }));
  fireEvent.change(screen.getByPlaceholderText(/שם/), { target: { value: 'לקוח' } });
  await waitFor(() => expect(state.archiveFilter).toHaveBeenCalledWith('archived_at', null));
  expect(await screen.findByText('ORD-ACTIVE')).toBeInTheDocument();
  expect(screen.queryByText('ORD-ARCHIVED')).not.toBeInTheDocument();
});
