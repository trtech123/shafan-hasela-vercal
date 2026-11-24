import { describe, expect, test, vi } from 'vitest';
import { mapDailyJournalBatch, runDailyRivhitBatch } from './daily.ts';

const mapping = { version: 'synthetic', provider: 'pelecard', site: 'נוף הגליל',
  sortCode: 901, debitAccount: 303, creditAccount: 201,
  vatRateBasisPoints: 1800, accountingDate: 'capture_israel_date' as const };
const source = (id: number, amount: number) => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  payper_document_number: `2000${id}`,
  source_facts: { provider: 'pelecard', site: 'נוף הגליל', amount,
    currency: 'ILS', receiptNumber: `RCP-${id}`, vatApplicable: true },
  captured_at: '2026-11-24T19:30:00Z',
});
const batchId = '00000000-0000-4000-8000-000000009999';

describe('daily aggregated Rivhit posting', () => {
  test('maps several finalized documents to one journal while preserving every source id', async () => {
    const result = await mapDailyJournalBatch([source(1, 118), source(2, 236)],
      mapping, batchId, '2026-11-24');
    expect(result.sourceIds).toEqual([source(1, 118).id, source(2, 236).id]);
    expect(result.draft).toMatchObject({ amount: 354, sort_code: 901,
      customer_id_debit: 303, customer_id_credit: 201,
      reference_date: '24112026', reference1: batchId, reference2: `SF-${batchId}` });
    expect(result.expectedVat).toBe(54);
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('rejects duplicate source membership and mixed site evidence', async () => {
    await expect(mapDailyJournalBatch([source(1, 118), source(1, 118)],
      mapping, batchId, '2026-11-24')).rejects.toThrow('daily_batch_invalid');
    await expect(mapDailyJournalBatch([source(1, 118), {
      ...source(2, 118), source_facts: { ...source(2, 118).source_facts, site: 'עכו' },
    }], mapping, batchId, '2026-11-24')).rejects.toThrow('journal_mapping_not_approved');
  });

  test('separate batches on the same day never share a Rivhit reconciliation reference', async () => {
    const first = await mapDailyJournalBatch([source(1, 118)], mapping,
      batchId, '2026-11-24');
    const second = await mapDailyJournalBatch([source(2, 118)], mapping,
      '00000000-0000-4000-8000-000000009998', '2026-11-24');
    expect(first.draft.reference1).not.toBe(second.draft.reference1);
    expect(first.draft.reference2).not.toBe(second.draft.reference2);
  });

  test('does not stage or post outside the Israel-time closing window', async () => {
    const store = { closingWindowOpen: vi.fn().mockResolvedValue(null),
      listUnmapped: vi.fn(), stageDaily: vi.fn(), defer: vi.fn(),
      listReady: vi.fn(), listPending: vi.fn().mockResolvedValue([]) };
    const process = vi.fn();
    const result = await runDailyRivhitBatch({ store, process,
      reconcile: vi.fn(), mappings: [mapping],
      ingestionEnabled: true, postingEnabled: true });
    expect(result).toEqual({ staged: 0, processed: 0, reconciled: 0, blocked: 0 });
    expect(store.stageDaily).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
  });

  test('groups by site and method; posts only claimed batch entries once', async () => {
    const cash = { ...source(3, 118), source_facts: {
      ...source(3, 118).source_facts, provider: 'manual_cash' } };
    const cashMapping = { ...mapping, provider: 'manual_cash', debitAccount: 301 };
    const store = { closingWindowOpen: vi.fn().mockResolvedValue('2026-11-24'),
      listUnmapped: vi.fn().mockResolvedValue([source(1, 118), source(2, 236), cash]),
      stageDaily: vi.fn().mockResolvedValue('entry'), defer: vi.fn(),
      listReady: vi.fn().mockResolvedValue(['entry-1']),
      listPending: vi.fn().mockResolvedValue([]) };
    const process = vi.fn().mockResolvedValue('uncertain');
    const result = await runDailyRivhitBatch({ store, process,
      reconcile: vi.fn(), mappings: [mapping, cashMapping],
      ingestionEnabled: true, postingEnabled: true, uuid: () => batchId });
    expect(result).toEqual({ staged: 2, processed: 1, reconciled: 0, blocked: 0 });
    expect(store.stageDaily.mock.calls[0][0]).toHaveLength(2);
    expect(store.stageDaily.mock.calls[1][0]).toHaveLength(1);
    expect(process).toHaveBeenCalledTimes(1);
  });

  test('an unresolved site is deferred and never assigned to a convenient account', async () => {
    const unknown = { ...source(1, 118), source_facts: {
      ...source(1, 118).source_facts, site: 'עכו' } };
    const store = { closingWindowOpen: vi.fn().mockResolvedValue('2026-11-24'),
      listUnmapped: vi.fn().mockResolvedValue([unknown]),
      stageDaily: vi.fn(), defer: vi.fn().mockResolvedValue(undefined),
      listReady: vi.fn().mockResolvedValue([]), listPending: vi.fn().mockResolvedValue([]) };
    const result = await runDailyRivhitBatch({ store, process: vi.fn(),
      reconcile: vi.fn(), mappings: [mapping],
      ingestionEnabled: true, postingEnabled: false });
    expect(result.blocked).toBe(1);
    expect(store.defer).toHaveBeenCalledWith(unknown.id);
    expect(store.stageDaily).not.toHaveBeenCalled();
  });

  test('one malformed document cannot delay the other finalized documents in its group', async () => {
    const invalid = { ...source(1, 118), source_facts: {
      ...source(1, 118).source_facts, vatApplicable: null } };
    const store = { closingWindowOpen: vi.fn().mockResolvedValue('2026-11-24'),
      listUnmapped: vi.fn().mockResolvedValue([invalid, source(2, 236)]),
      stageDaily: vi.fn().mockResolvedValue('entry-1'),
      defer: vi.fn().mockResolvedValue(undefined),
      listReady: vi.fn().mockResolvedValue([]),
      listPending: vi.fn().mockResolvedValue([]) };
    const result = await runDailyRivhitBatch({ store, process: vi.fn(),
      reconcile: vi.fn(), mappings: [mapping],
      ingestionEnabled: true, postingEnabled: false, uuid: () => batchId });
    expect(result).toEqual({ staged: 1, processed: 0, reconciled: 0, blocked: 1 });
    expect(store.defer).toHaveBeenCalledWith(invalid.id);
    expect(store.stageDaily.mock.calls[0][0]).toEqual([source(2, 236)]);
  });
});
