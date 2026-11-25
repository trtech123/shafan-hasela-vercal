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
      listDailyEligible: vi.fn(), stageDaily: vi.fn(), deferMany: vi.fn(),
      batchForSources: vi.fn(), dailyGroupExists: vi.fn(),
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
      listDailyEligible: vi.fn().mockResolvedValue([source(1, 118), source(2, 236), cash]),
      stageDaily: vi.fn().mockResolvedValue('entry'), deferMany: vi.fn(),
      batchForSources: vi.fn(), dailyGroupExists: vi.fn(),
      listReady: vi.fn().mockResolvedValue(['entry-1']),
      listPending: vi.fn().mockResolvedValue([]) };
    const process = vi.fn().mockResolvedValue('uncertain');
    const result = await runDailyRivhitBatch({ store, process,
      reconcile: vi.fn(), mappings: [mapping, cashMapping],
      ingestionEnabled: true, postingEnabled: true, uuid: () => batchId });
    expect(result).toEqual({ staged: 2, processed: 1, reconciled: 0, blocked: 0 });
    expect(store.listDailyEligible).toHaveBeenCalledWith(501, '2026-11-24');
    expect(store.stageDaily.mock.calls[0][0]).toHaveLength(2);
    expect(store.stageDaily.mock.calls[1][0]).toHaveLength(1);
    expect(process).toHaveBeenCalledTimes(1);
    expect(store.listReady).toHaveBeenCalledWith(1);
    expect(store.listPending).not.toHaveBeenCalled();
  });

  test('uses a later cron run for readback without another provider submission', async () => {
    const store = { closingWindowOpen: vi.fn().mockResolvedValue('2026-11-24'),
      listDailyEligible: vi.fn().mockResolvedValue([]), stageDaily: vi.fn(),
      deferMany: vi.fn(), batchForSources: vi.fn(), dailyGroupExists: vi.fn(),
      listReady: vi.fn().mockResolvedValue([]),
      listPending: vi.fn().mockResolvedValue(['held-entry']) };
    const process = vi.fn();
    const reconcile = vi.fn().mockResolvedValue('no_match');
    const result = await runDailyRivhitBatch({ store, process, reconcile,
      mappings: [mapping], ingestionEnabled: true, postingEnabled: true });
    expect(result).toEqual({ staged: 0, processed: 0, reconciled: 1, blocked: 0 });
    expect(store.listPending).toHaveBeenCalledWith(1);
    expect(process).not.toHaveBeenCalled();
  });

  test('an unresolved site is deferred and never assigned to a convenient account', async () => {
    const unknown = { ...source(1, 118), source_facts: {
      ...source(1, 118).source_facts, site: 'עכו' } };
    const store = { closingWindowOpen: vi.fn().mockResolvedValue('2026-11-24'),
      listDailyEligible: vi.fn().mockResolvedValue([unknown]),
      stageDaily: vi.fn(), deferMany: vi.fn().mockResolvedValue(1),
      batchForSources: vi.fn(), dailyGroupExists: vi.fn(),
      listReady: vi.fn().mockResolvedValue([]), listPending: vi.fn().mockResolvedValue([]) };
    const result = await runDailyRivhitBatch({ store, process: vi.fn(),
      reconcile: vi.fn(), mappings: [mapping],
      ingestionEnabled: true, postingEnabled: false });
    expect(result.blocked).toBe(1);
    expect(store.deferMany).toHaveBeenCalledWith([unknown.id], 'site_mapping_unapproved');
    expect(store.stageDaily).not.toHaveBeenCalled();
  });

  test('one malformed document cannot delay the other finalized documents in its group', async () => {
    const invalid = { ...source(1, 118), source_facts: {
      ...source(1, 118).source_facts, vatApplicable: null } };
    const store = { closingWindowOpen: vi.fn().mockResolvedValue('2026-11-24'),
      listDailyEligible: vi.fn().mockResolvedValue([invalid, source(2, 236)]),
      stageDaily: vi.fn().mockResolvedValue('entry-1'),
      deferMany: vi.fn().mockResolvedValue(1),
      batchForSources: vi.fn(), dailyGroupExists: vi.fn(),
      listReady: vi.fn().mockResolvedValue([]),
      listPending: vi.fn().mockResolvedValue([]) };
    const result = await runDailyRivhitBatch({ store, process: vi.fn(),
      reconcile: vi.fn(), mappings: [mapping],
      ingestionEnabled: true, postingEnabled: false, uuid: () => batchId });
    expect(result).toEqual({ staged: 1, processed: 0, reconciled: 0, blocked: 1 });
    expect(store.deferMany).toHaveBeenCalledWith([invalid.id], 'source_evidence_incomplete');
    expect(store.stageDaily.mock.calls[0][0]).toEqual([source(2, 236)]);
  });

  test('an unclassified historical activity cannot delay a classified source', async () => {
    const unresolved = { ...source(1, 118), source_facts: {
      ...source(1, 118).source_facts, activitySiteResolved: false } };
    const resolved = { ...source(2, 118), source_facts: {
      ...source(2, 118).source_facts, activitySiteResolved: true } };
    const store = { closingWindowOpen: vi.fn().mockResolvedValue('2026-11-24'),
      listDailyEligible: vi.fn().mockResolvedValue([unresolved, resolved]),
      stageDaily: vi.fn().mockResolvedValue('entry-1'),
      deferMany: vi.fn().mockResolvedValue(1), batchForSources: vi.fn(),
      dailyGroupExists: vi.fn(), listReady: vi.fn().mockResolvedValue([]),
      listPending: vi.fn().mockResolvedValue([]) };
    const result = await runDailyRivhitBatch({ store, process: vi.fn(),
      reconcile: vi.fn(), mappings: [mapping], ingestionEnabled: true,
      postingEnabled: false, uuid: () => batchId });
    expect(result).toEqual({ staged: 1, processed: 0, reconciled: 0, blocked: 1 });
    expect(store.deferMany).toHaveBeenCalledWith([unresolved.id], 'activity_site_unresolved');
    expect(store.stageDaily.mock.calls[0][0]).toEqual([resolved]);
  });

  test('resolves a lost staging response from committed source membership', async () => {
    const store = { closingWindowOpen: vi.fn().mockResolvedValue('2026-11-24'),
      listDailyEligible: vi.fn().mockResolvedValue([source(1, 118)]),
      stageDaily: vi.fn().mockRejectedValue(new Error('connection_lost')),
      deferMany: vi.fn(), batchForSources: vi.fn().mockResolvedValue(batchId),
      dailyGroupExists: vi.fn(), listReady: vi.fn().mockResolvedValue([]),
      listPending: vi.fn().mockResolvedValue([]) };
    const result = await runDailyRivhitBatch({ store, process: vi.fn(),
      reconcile: vi.fn(), mappings: [mapping], ingestionEnabled: true,
      postingEnabled: false });
    expect(result).toEqual({ staged: 1, processed: 0, reconciled: 0, blocked: 0 });
    expect(store.deferMany).not.toHaveBeenCalled();
  });

  test('a staging failure is retried safely without treating the group as closed', async () => {
    const store = { closingWindowOpen: vi.fn().mockResolvedValue('2026-11-24'),
      listDailyEligible: vi.fn().mockResolvedValue([source(1, 118)]),
      stageDaily: vi.fn().mockRejectedValue(new Error('database_unavailable')),
      deferMany: vi.fn().mockResolvedValue(1),
      batchForSources: vi.fn().mockResolvedValue(null),
      dailyGroupExists: vi.fn().mockResolvedValue(true),
      listReady: vi.fn().mockResolvedValue([]), listPending: vi.fn().mockResolvedValue([]) };
    const result = await runDailyRivhitBatch({ store, process: vi.fn(),
      reconcile: vi.fn(), mappings: [mapping], ingestionEnabled: true,
      postingEnabled: false });
    expect(result.blocked).toBe(1);
    expect(store.deferMany).toHaveBeenCalledWith([source(1, 118).id], 'daily_stage_failed');
  });

  test('stages a bounded group and leaves the next source for the same-day catch-up', async () => {
    const many = Array.from({ length: 501 }, (_, index) => source(index + 1, 118));
    const store = { closingWindowOpen: vi.fn().mockResolvedValue('2026-11-24'),
      listDailyEligible: vi.fn().mockResolvedValue(many),
      stageDaily: vi.fn().mockResolvedValue('entry'), deferMany: vi.fn(),
      batchForSources: vi.fn(), dailyGroupExists: vi.fn(),
      listReady: vi.fn().mockResolvedValue([]), listPending: vi.fn().mockResolvedValue([]) };
    const result = await runDailyRivhitBatch({ store, process: vi.fn(),
      reconcile: vi.fn(), mappings: [mapping], ingestionEnabled: true,
      postingEnabled: false, uuid: () => batchId });
    expect(result).toMatchObject({ staged: 1, blocked: 0 });
    expect(store.stageDaily.mock.calls[0][0]).toHaveLength(500);
    expect(store.stageDaily.mock.calls[0][0]).not.toContainEqual(source(501, 118));
    expect(store.deferMany).not.toHaveBeenCalled();
  });
});
