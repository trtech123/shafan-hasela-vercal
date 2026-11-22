import { describe, expect, test, vi } from 'vitest';
import { reconcileRivhitJournal } from './reconcile.ts';

const claim = { id: 'entry-1', status: 'reconciliation_required', expectedVat: 18,
  providerYear: 2026, providerMonth: 11, providerLine: 9,
  draft: { sort_code: 12, customer_id_debit: 101, customer_id_credit: 201,
    amount: 118, reference_date: '22112026', reference1: '200010',
    reference2: 'RCP-2000', request_reference: 'source-1' } };
const row = { journal_id: 42, journal_year: 2026, journal_month: 11,
  debit_customer_id: 101, credit_customer_id: 201, sort_code: 12,
  total_amount: 118, total_vat: 18, total_without_vat: 100,
  reference_date: '22112026', reference1: '200010', reference2: 'RCP-2000' };

describe('readback-only journal recovery', () => {
  test('verifies a saved provider response against exact readback without reposting', async () => {
    const store = { inspect: vi.fn().mockResolvedValue(claim), verify: vi.fn(),
      noteCandidate: vi.fn(), hold: vi.fn() };
    const provider = { journalsReport: vi.fn().mockResolvedValue([row]) };
    await expect(reconcileRivhitJournal('entry-1', { store, provider })).resolves.toBe('verified');
    expect(store.verify).toHaveBeenCalledWith('entry-1', row);
    expect(store.noteCandidate).not.toHaveBeenCalled();
  });

  test('records only a candidate when the AddJournal response was lost', async () => {
    const store = { inspect: vi.fn().mockResolvedValue({ ...claim, providerYear: null,
      providerMonth: null, providerLine: null }), verify: vi.fn(), noteCandidate: vi.fn(), hold: vi.fn() };
    const provider = { journalsReport: vi.fn().mockResolvedValue([row]) };
    await expect(reconcileRivhitJournal('entry-1', { store, provider }))
      .resolves.toBe('candidate_requires_review');
    expect(store.noteCandidate).toHaveBeenCalledWith('entry-1', 42, 'candidate_without_response');
    expect(store.verify).not.toHaveBeenCalled();
  });
});
