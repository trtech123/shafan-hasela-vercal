// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rows: [], rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock('../components/quotes/QuoteFormDialog', () => ({ default: () => null }));
vi.mock('../components/quotes/QuotePDFDocument', () => ({ default: ({ quote, mode }) =>
  <div role="dialog">{mode}: {quote.order_number}: {quote.selected_activities?.map(item => item.activity_name).join(', ')}</div> }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import Quotes from './Quotes';

const sampleQuote = () => ({
  id: 'quote-1', quote_number: 'QUO-1', quotation_version: 2,
  quotation_revision_id: 'revision-2', client_name: 'Synthetic customer',
  client_phone: '0500000000', event_date: '2026-11-05', site: 'עכו',
  num_participants: 2, final_price: 80, status: 'טיוטה',
  selected_activities: [
    { item_type: 'activity', activity_id: 'activity-1', activity_name: 'Synthetic activity', price_per_person: 30 },
    { item_type: 'product', product_id: 'product-1', activity_name: 'Synthetic product', price_per_person: 10 },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [sampleQuote()];
  mocks.from.mockImplementation(table => {
    if (table === 'quotes') return { select: () => ({ order: () => ({ limit: async () => ({ data: mocks.rows, error: null }) }) }) };
    if (table === 'activities') return { select: async () => ({ data: [], error: null }) };
    throw new Error(`Unexpected direct table write/read: ${table}`);
  });
  mocks.rpc.mockImplementation(async () => ({ data: {
    id: 'order-1', order_number: 'ORD-1', quote_id: 'quote-1',
    quotation_snapshot: sampleQuote(),
  }, error: null }));
});
afterEach(cleanup);

test('converts a saved quotation atomically through the existing RPC and previews its frozen items', async () => {
  render(<Quotes />);
  fireEvent.click(await screen.findByRole('button', { name: 'הפוך להזמנה' }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
  expect(mocks.rpc).toHaveBeenCalledWith('convert_quotation_to_order', {
    p_quote_id: 'quote-1', p_expected_version: 2,
  });
  expect(mocks.from).not.toHaveBeenCalledWith('orders');
  expect(await screen.findByRole('status')).toHaveTextContent('ההצעה הומרה להזמנה בהצלחה');
  expect(screen.getByRole('dialog')).toHaveTextContent('Synthetic activity, Synthetic product');
  expect(screen.queryByRole('button', { name: 'עריכה' })).not.toBeInTheDocument();
});

test('repeated clicks during conversion send one request', async () => {
  let finish;
  mocks.rpc.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<Quotes />);
  const button = await screen.findByRole('button', { name: 'הפוך להזמנה' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(button).toBeDisabled();
  finish({ data: { id: 'order-1', order_number: 'ORD-1', quote_id: 'quote-1', quotation_snapshot: sampleQuote() }, error: null });
  expect(await screen.findByRole('status')).toHaveTextContent('ההצעה הומרה להזמנה בהצלחה');
});

test('RPC conflict shows a visible Hebrew error without any direct order insert', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'quotation_order_link_conflict' } });
  render(<Quotes />);
  fireEvent.click(await screen.findByRole('button', { name: 'הפוך להזמנה' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('הזמנה');
  expect(mocks.from).not.toHaveBeenCalledWith('orders');
});

test('an unknown network outcome can be retried through the idempotent RPC', async () => {
  mocks.rpc.mockRejectedValueOnce(new Error('network lost'));
  render(<Quotes />);
  fireEvent.click(await screen.findByRole('button', { name: 'הפוך להזמנה' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('תוצאת ההמרה');
  fireEvent.click(screen.getByRole('button', { name: 'הפוך להזמנה' }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
  expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  expect(mocks.from).not.toHaveBeenCalledWith('orders');
});

test('legacy quotation without a revision asks for a save before conversion', async () => {
  mocks.rows[0].quotation_version = 0;
  mocks.rows[0].quotation_revision_id = null;
  render(<Quotes />);
  expect(await screen.findByText('Synthetic customer')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'הפוך להזמנה' })).not.toBeInTheDocument();
  expect(screen.getByText(/שמרו את ההצעה/)).toBeInTheDocument();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

test('legacy quotation without an event date directs the user to complete it before saving', async () => {
  mocks.rows[0].quotation_version = 0;
  mocks.rows[0].quotation_revision_id = null;
  mocks.rows[0].event_date = null;
  render(<Quotes />);
  expect(await screen.findByText(/השלימו תאריך אירוע/)).toBeInTheDocument();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

test('saved quotation missing conversion fields does not call the RPC', async () => {
  mocks.rows[0].event_date = null;
  render(<Quotes />);
  fireEvent.click(await screen.findByRole('button', { name: 'הפוך להזמנה' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('תאריך אירוע');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
