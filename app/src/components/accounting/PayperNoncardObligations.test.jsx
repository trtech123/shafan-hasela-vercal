// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { expect, it, vi } from 'vitest';
import PayperNoncardObligations from './PayperNoncardObligations';

const rows = [
  { payment_id: 'check-1', order_id: 'order-1', sale_id: 'sale-1', state: 'reconciliation_required',
    source_facts: { sourceType: 'manual_check' }, reconciliation_code: 'provider_transport_uncertain' },
  { payment_id: 'card-1', order_id: 'order-2', sale_id: 'sale-2', state: 'source_frozen',
    source_facts: { sourceType: 'pelecard' } },
];
const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
const order = vi.fn(() => ({ limit }));
const states = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ in: states }));
const from = vi.fn(() => ({ select }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...args) => from(...args) } }));

it('shows only pending non-card obligations in Admin Accounting', async () => {
  render(<PayperNoncardObligations />);
  expect(await screen.findByText(/הזמנה order-1/)).toBeInTheDocument();
  expect(screen.getByText(/provider_transport_uncertain/)).toBeInTheDocument();
  expect(screen.queryByText(/order-2/)).not.toBeInTheDocument();
  expect(from).toHaveBeenCalledWith('payper_document_ledger');
});
