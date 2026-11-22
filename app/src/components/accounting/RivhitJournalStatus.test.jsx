// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import RivhitJournalStatus from './RivhitJournalStatus';

const from = vi.fn();
const invoke = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: {
  from: (...args) => from(...args), functions: { invoke: (...args) => invoke(...args) },
} }));
afterEach(() => { cleanup(); from.mockReset(); invoke.mockReset(); });

function query(data, error = null) {
  return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data, error }) }),
    single: () => Promise.resolve({ data, error }) }) };
}
const control = { capture_enabled: false, posting_enabled: false, cutover_at: null };

test('shows Payper and Rivhit references without posting or retry controls', async () => {
  from.mockImplementation((table) => table === 'rivhit_journal_control' ? query(control)
    : table === 'rivhit_journal_sources'
    ? query([{ id: 'source-1', payper_document_number: '200010', state: 'mapped', payper_document_url: 'https://app.payper.co.il/public/invoice_show/3554599?ak=opaque' }])
    : query([{ id: 'entry-1', source_id: 'source-1', status: 'verified', provider_year: 2026,
      provider_month: 11, provider_line: 42, hold_reason: null }]));
  render(<RivhitJournalStatus />);
  expect(await screen.findByText(/200010/)).toBeInTheDocument();
  expect(screen.getByText(/2026\/11\/42/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'מסמך Payper' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByRole('button', { name: /שדר|נסה שוב|אשר/ })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('שידור לריווחית: כבוי');
});

test('shows unavailable rather than claiming zero records on permission failure', async () => {
  from.mockReturnValue(query(null, new Error('permission denied')));
  render(<RivhitJournalStatus />);
  expect(await screen.findByRole('alert')).toHaveTextContent('לא ניתן לטעון');
});

test('shows each journal line when an accounting document needs multiple entries', async () => {
  from.mockImplementation((table) => table === 'rivhit_journal_control' ? query(control)
    : table === 'rivhit_journal_sources'
    ? query([{ id: 'source-1', payper_document_number: '200010', state: 'mapped' }])
    : query([
      { id: 'entry-1', source_id: 'source-1', status: 'verified', provider_year: 2026, provider_month: 11, provider_line: 42 },
      { id: 'entry-2', source_id: 'source-1', status: 'reconciliation_required', hold_reason: 'readback_missing' },
    ]));
  render(<RivhitJournalStatus />);
  expect(await screen.findByText(/2026\/11\/42/)).toBeInTheDocument();
  expect(screen.getByText(/readback_missing/)).toBeInTheDocument();
});

test('reads sort codes through the authenticated function without a write control or token', async () => {
  from.mockImplementation(table => query(table === 'rivhit_journal_control' ? control : []));
  invoke.mockResolvedValue({ data: { rows: [{ sort_code: 7, description: 'synthetic', customer_name: 'hidden' }] }, error: null });
  render(<RivhitJournalStatus />);
  fireEvent.click(screen.getByRole('button', { name: 'הצג קודי מיון' }));
  expect(await screen.findByText(/נמצאו 1 רשומות/)).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith('rivhit-journal-readonly', { body: { operation: 'sort_codes' } });
  expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();
});

test('reads a date-scoped report through the authenticated function', async () => {
  from.mockImplementation(table => query(table === 'rivhit_journal_control' ? control : []));
  invoke.mockResolvedValue({ data: { rows: [] }, error: null });
  render(<RivhitJournalStatus />);
  fireEvent.change(screen.getByLabelText('תאריך פקודות'), { target: { value: '2026-11-19' } });
  fireEvent.click(screen.getByRole('button', { name: 'הצג פקודות קיימות' }));
  expect(await screen.findByText(/נמצאו 0 רשומות/)).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith('rivhit-journal-readonly', {
    body: { operation: 'journal_report', date: '19112026' },
  });
});
