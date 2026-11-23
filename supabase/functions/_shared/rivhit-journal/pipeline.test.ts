import { describe, expect, test, vi } from 'vitest';
import { runRivhitJournalBatch } from './batch.ts';
import { mapJournalSource } from './mapper.ts';
import { processRivhitJournal } from './processor.ts';

const source = {
  id: '00000000-0000-4000-8000-000000000001', payper_document_number: '200010',
  captured_at: '2026-11-22T12:30:00Z',
  source_facts: { provider: 'pelecard', site: 'עכו', amount: 118, currency: 'ILS',
    receiptNumber: 'RCP-2000', vatApplicable: true },
};
const mapping = { version: 'synthetic', provider: 'pelecard' as const, site: 'עכו' as const,
  sortCode: 12, debitAccount: 101, creditAccount: 201,
  vatRateBasisPoints: 1800, accountingDate: 'capture_israel_date' as const };

describe('synthetic Payper to Rivhit pipeline', () => {
  test('ingests, claims once, saves provider response and verifies report evidence', async () => {
    let entry: Awaited<ReturnType<typeof mapJournalSource>> | null = null;
    let status = 'mapping_required';
    let savedResponse = false;
    let verified = false;
    const store = {
      listUnmapped: vi.fn(async () => status === 'mapping_required' ? [source] : []),
      stage: vi.fn(async () => { entry = await mapJournalSource(source, mapping); status = 'ready'; return 'entry-1'; }),
      defer: vi.fn(async () => {}),
      listReady: vi.fn(async () => status === 'ready' ? ['entry-1'] : []),
      listPending: vi.fn(async () => []),
      claim: vi.fn(async () => status === 'ready' && entry
        ? { id: 'entry-1', draft: entry.draft, expectedVat: entry.expectedVat } : null),
      reserve: vi.fn(async () => { if (status !== 'ready') return false; status = 'reserved'; return true; }),
      recordResponse: vi.fn(async () => { savedResponse = true; status = 'response_saved'; }),
      verify: vi.fn(async () => { verified = true; status = 'verified'; }),
      hold: vi.fn(async () => { status = 'reconciliation_required'; }),
    };
    const provider = {
      journalsReport: vi.fn(async () => savedResponse ? [{
        journal_id: 42, journal_year: 2026, journal_month: 11,
        debit_customer_id: 101, credit_customer_id: 201, sort_code: 12,
        reference1: '200010', reference2: 'RCP-2000', reference_date: '22/11/2026',
        total_amount: 118, total_vat: 18, total_without_vat: 100,
      }] : []),
      addJournal: vi.fn(async () => ({ year: 2026, month: 11, line: 9 })),
    };
    const process = (id: string) => processRivhitJournal(id, { store, provider });
    const first = await runRivhitJournalBatch({ store, process, reconcile: async () => 'not_pending',
      mappings: [mapping], ingestionEnabled: true, postingEnabled: true });
    expect(first).toEqual({ staged: 1, processed: 1, reconciled: 0, blocked: 0 });
    expect(savedResponse).toBe(true);
    expect(verified).toBe(true);
    await runRivhitJournalBatch({ store, process, reconcile: async () => 'not_pending',
      mappings: [mapping], ingestionEnabled: true, postingEnabled: true });
    expect(provider.addJournal).toHaveBeenCalledTimes(1);
    expect(store.reserve).toHaveBeenCalledTimes(1);
  });
});
