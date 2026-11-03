// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn(table => {
    if (table === 'quotes') return { select: () => ({ order: () => ({ limit: async () => ({ data: [{
      id: 'quote-1', quote_number: 'QUO-1', quotation_version: 1,
      quotation_revision_id: 'revision-1', client_name: 'Synthetic customer',
      event_date: '2026-11-05', num_participants: 2, final_price: 30,
      status: 'טיוטה', selected_activities: [{
        item_type: 'product', product_id: 'product-1', activity_id: null,
        activity_name: 'Synthetic product', price_per_person: 15,
      }],
    }], error: null }) }) }) };
    if (table === 'activities') return { select: async () => ({ data: [], error: null }) };
    throw new Error(`Unexpected table access: ${table}`);
  }),
  rpc: vi.fn(async () => ({ data: {
    id: 'order-1', quote_id: 'quote-1', order_number: 'ORD-1',
    quotation_snapshot: { selected_activities: [{ item_type: 'product', activity_name: 'Synthetic product' }] },
  }, error: null })),
}));

vi.mock('@/api/supabaseClient', () => ({ supabase: { from, rpc } }));
vi.mock('../components/quotes/QuoteFormDialog', () => ({ default: () => null }));
vi.mock('../components/quotes/QuotePDFDocument', () => ({ default: ({ quote }) =>
  <div role="dialog">{quote.selected_activities?.map(item => item.activity_name).join(', ')}</div> }));

import Quotes from './Quotes';

afterEach(cleanup);

test('converts a product quote through the authoritative RPC without dropping the product snapshot', async () => {
  render(<Quotes />);
  fireEvent.click(await screen.findByRole('button', { name: 'הפוך להזמנה' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('convert_quotation_to_order', {
    p_quote_id: 'quote-1', p_expected_version: 1,
  }));
  expect(from).not.toHaveBeenCalledWith('orders');
  expect(await screen.findByRole('dialog')).toHaveTextContent('Synthetic product');
});
