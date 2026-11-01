// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import PayperIssuedDocuments from './PayperIssuedDocuments';

const query = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...args) => query(...args) } }));
afterEach(() => { cleanup(); query.mockReset(); });

function withRows(rows, error = null) {
  query.mockReturnValue({ select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: rows, error }) }) }) }) });
}

test('shows only a validated provider document link without exposing billing identity', async () => {
  withRows([{ order_id: 'order-1', document_number: '595166', provider_trx_record_id: '103059585',
    document_url: 'https://app.payper.co.il/public/invoice_show/595166?ak=opaque' }]);
  render(<PayperIssuedDocuments />);
  const link = await screen.findByRole('link', { name: 'פתיחת מסמך Payper' });
  expect(link).toHaveAttribute('href', 'https://app.payper.co.il/public/invoice_show/595166?ak=opaque');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(screen.getByRole('region')).toHaveTextContent('103059585');
  expect(screen.getByRole('region')).toHaveTextContent('הצלחת ההפקה אינה אישור שהאימייל נמסר');
  expect(screen.getByRole('region').textContent).not.toContain('000000018');
  expect(query).toHaveBeenCalledWith('payper_document_ledger');
});

test('rejects unrelated or mismatched provider links', async () => {
  withRows([{ order_id: 'order-1', document_number: '595166',
    document_url: 'https://app.payper.co.il/public/invoice_show/123?ak=opaque' }]);
  render(<PayperIssuedDocuments />);
  expect(await screen.findByRole('alert')).toHaveTextContent('קישור המסמך אינו תקין');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('does not claim there are no documents when the protected query fails', async () => {
  withRows(null, new Error('permission denied'));
  render(<PayperIssuedDocuments />);
  expect(await screen.findByRole('alert')).toHaveTextContent('לא ניתן לטעון');
});
