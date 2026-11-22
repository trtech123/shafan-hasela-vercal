// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import RivhitJournalStatus from './RivhitJournalStatus';

const from = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...args) => from(...args) } }));
afterEach(() => { cleanup(); from.mockReset(); });

function query(data, error = null) {
  return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data, error }) }) }) };
}

test('shows Payper and Rivhit references without posting or retry controls', async () => {
  from.mockImplementation((table) => table === 'rivhit_journal_sources'
    ? query([{ id: 'source-1', payper_document_number: '200010', state: 'mapped', payper_document_url: 'https://app.payper.co.il/public/invoice_show/3554599?ak=opaque' }])
    : query([{ id: 'entry-1', source_id: 'source-1', status: 'verified', provider_year: 2026,
      provider_month: 11, provider_line: 42, hold_reason: null }]));
  render(<RivhitJournalStatus />);
  expect(await screen.findByText(/200010/)).toBeInTheDocument();
  expect(screen.getByText(/2026\/11\/42/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'מסמך Payper' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByRole('button', { name: /שדר|נסה שוב|אשר/ })).not.toBeInTheDocument();
});

test('shows unavailable rather than claiming zero records on permission failure', async () => {
  from.mockReturnValue(query(null, new Error('permission denied')));
  render(<RivhitJournalStatus />);
  expect(await screen.findByRole('alert')).toHaveTextContent('לא ניתן לטעון');
});

test('shows each journal line when an accounting document needs multiple entries', async () => {
  from.mockImplementation((table) => table === 'rivhit_journal_sources'
    ? query([{ id: 'source-1', payper_document_number: '200010', state: 'mapped' }])
    : query([
      { id: 'entry-1', source_id: 'source-1', status: 'verified', provider_year: 2026, provider_month: 11, provider_line: 42 },
      { id: 'entry-2', source_id: 'source-1', status: 'reconciliation_required', hold_reason: 'readback_missing' },
    ]));
  render(<RivhitJournalStatus />);
  expect(await screen.findByText(/2026\/11\/42/)).toBeInTheDocument();
  expect(screen.getByText(/readback_missing/)).toBeInTheDocument();
});
