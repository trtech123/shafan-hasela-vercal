// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import Leads from './Leads';

const from = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...args) => from(...args) } }));
vi.mock('@/components/quotes/QuoteFormDialog', () => ({ default: () => null }));

afterEach(() => { cleanup(); from.mockReset(); });

test('shows a landing submission in the existing CRM with source and campaign', async () => {
  const data = [{ id: 'synthetic-lead', full_name: 'Synthetic Customer',
    phone: '0501234567', email: 'synthetic@example.invalid', status: 'פתוח',
    lead_source: 'landing_page', lead_attribution: { campaign: 'winter', utmSource: 'search' },
    source_text: 'Group activity', created_at: '2026-11-16T10:00:00Z' }];
  const builder = { select: () => builder, order: () => builder,
    limit: vi.fn().mockResolvedValue({ data, error: null }) };
  from.mockReturnValue(builder);
  render(<Leads />);
  expect((await screen.findAllByText('Synthetic Customer')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('דף נחיתה').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/winter/).length).toBeGreaterThan(0);
  expect(from).toHaveBeenCalledWith('leads');
});
