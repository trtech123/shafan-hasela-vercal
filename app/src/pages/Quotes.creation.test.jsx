// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@/api/supabaseClient', () => ({ supabase: { from: table => ({
  select: () => table === 'quotes'
    ? { order: () => ({ limit: async () => ({ data: [], error: null }) }) }
    : Promise.resolve({ data: [], error: null }),
}) } }));
vi.mock('../components/quotes/QuoteFormDialog', () => ({ default: ({ open, onSaved }) => open
  ? <button type="button" onClick={() => onSaved({ id: 'synthetic-quote' })}>שמור הצעת בדיקה</button>
  : null }));
vi.mock('../components/quotes/QuotePDFDocument', () => ({ default: () => null }));

import Quotes from './Quotes';
afterEach(cleanup);

test('shows a persistent Hebrew success confirmation after quotation creation', async () => {
  render(<Quotes />);
  fireEvent.click(await screen.findByRole('button', { name: 'הצעה חדשה' }));
  fireEvent.click(screen.getByRole('button', { name: 'שמור הצעת בדיקה' }));
  expect(await screen.findByRole('status')).toHaveTextContent('ההצעה נשמרה בהצלחה');
});
