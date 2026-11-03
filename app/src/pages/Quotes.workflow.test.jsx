// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rows: [], rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock('../components/quotes/QuotePDFDocument', () => ({ default: ({ quote, mode }) =>
  <div role="dialog">{mode}: {quote.order_number}: {quote.selected_activities?.[0]?.activity_name}</div> }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import Quotes from './Quotes';
afterEach(cleanup);

test('creates a quotation and converts that saved revision to one linked order', async () => {
  mocks.rows = [];
  mocks.rpc.mockReset();
  mocks.from.mockReset();
  const activity = { id: 'activity-1', name: 'Synthetic activity', price_per_person: 25, status: 'פעיל' };
  mocks.from.mockImplementation(table => {
    if (table === 'quotes') return { select: () => ({ order: () => ({ limit: async () => ({ data: mocks.rows, error: null }) }) }) };
    if (table === 'activities' || table === 'products') return { select: () => {
      const result = Promise.resolve({ data: table === 'activities' ? [activity] : [], error: null });
      result.eq = () => result;
      return result;
    } };
    throw new Error(`Unexpected table access: ${table}`);
  });
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === 'save_quotation') {
      const saved = { ...args.p_data, id: 'quote-1', quote_number: 'QUO-1',
        quotation_version: 1, quotation_revision_id: 'revision-1',
        total_price: 50, final_price: 50 };
      mocks.rows = [saved];
      return { data: saved, error: null };
    }
    if (name === 'convert_quotation_to_order') return { data: {
      id: 'order-1', quote_id: 'quote-1', order_number: 'ORD-1',
      quotation_snapshot: mocks.rows[0],
    }, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  render(<Quotes />);
  fireEvent.click(await screen.findByRole('button', { name: 'הצעה חדשה' }));
  const dialog = await screen.findByRole('dialog');
  const textboxes = within(dialog).getAllByRole('textbox');
  fireEvent.change(textboxes[0], { target: { value: 'Synthetic customer' } });
  fireEvent.change(textboxes[1], { target: { value: '0500000000' } });
  fireEvent.change(dialog.querySelector('input[type="date"]'), { target: { value: '2026-11-05' } });
  fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '2' } });
  fireEvent.click(await within(dialog).findByRole('button', { name: /Synthetic activity/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'צור הצעה' }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('save_quotation', expect.objectContaining({
    p_quote_id: null, p_expected_version: 0,
  })));
  expect(await screen.findByText('Synthetic customer')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'הפוך להזמנה' }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('convert_quotation_to_order', {
    p_quote_id: 'quote-1', p_expected_version: 1,
  }));
  expect(await screen.findByText('הומר להזמנה')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toHaveTextContent('Synthetic activity');
  expect(mocks.from).not.toHaveBeenCalledWith('orders');
});
