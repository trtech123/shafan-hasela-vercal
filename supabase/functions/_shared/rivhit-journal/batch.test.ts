import { describe, expect, test, vi } from 'vitest';
import { runRivhitJournalBatch } from './batch.ts';

const source = { id: 'source-1', source_facts: { provider: 'pelecard', site: 'עכו' } };
const mapping = { version: 'approved', provider: 'pelecard', site: 'עכו' };

function fixture() {
  const store = {
    listUnmapped: vi.fn().mockResolvedValue([source]),
    stage: vi.fn().mockResolvedValue('entry-1'),
    defer: vi.fn().mockResolvedValue(undefined),
    listReady: vi.fn().mockResolvedValue(['entry-1']),
    listPending: vi.fn().mockResolvedValue([]),
  };
  const process = vi.fn().mockResolvedValue('verified');
  const reconcile = vi.fn().mockResolvedValue('verified');
  return { store, process, reconcile };
}

describe('scheduled journal batch', () => {
  test('ingests a finalized source but cannot post while the posting gate is off', async () => {
    const { store, process, reconcile } = fixture();
    const result = await runRivhitJournalBatch({ store, process, reconcile,
      mappings: [mapping], ingestionEnabled: true, postingEnabled: false });
    expect(result).toEqual({ staged: 1, processed: 0, reconciled: 0, blocked: 0 });
    expect(store.stage).toHaveBeenCalledWith(source, mapping);
    expect(store.listReady).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
  });

  test('a missing approved mapping leaves the source unposted', async () => {
    const { store, process, reconcile } = fixture();
    const result = await runRivhitJournalBatch({ store, process, reconcile,
      mappings: [], ingestionEnabled: true, postingEnabled: true });
    expect(result.blocked).toBe(1);
    expect(store.stage).not.toHaveBeenCalled();
    expect(store.defer).toHaveBeenCalledWith(source.id);
  });

  test('a source with no saved site is deferred even if a null mapping exists', async () => {
    const { store, process, reconcile } = fixture();
    store.listUnmapped.mockResolvedValue([{ ...source, source_facts: { provider: 'pelecard', site: null } }]);
    const result = await runRivhitJournalBatch({ store, process, reconcile,
      mappings: [{ ...mapping, site: null }], ingestionEnabled: true, postingEnabled: false });
    expect(result.blocked).toBe(1);
    expect(store.stage).not.toHaveBeenCalled();
  });

  test('a mapping failure is deferred so later sources are not starved', async () => {
    const { store, process, reconcile } = fixture();
    store.stage.mockRejectedValue(new Error('missing evidence'));
    const result = await runRivhitJournalBatch({ store, process, reconcile,
      mappings: [mapping], ingestionEnabled: true, postingEnabled: false });
    expect(result.blocked).toBe(1);
    expect(store.defer).toHaveBeenCalledWith(source.id);
  });

  test('uses the durable ready queue and never retries an uncertain result in one run', async () => {
    const { store, process, reconcile } = fixture();
    process.mockResolvedValue('uncertain');
    const result = await runRivhitJournalBatch({ store, process, reconcile,
      mappings: [mapping], ingestionEnabled: true, postingEnabled: true });
    expect(result).toEqual({ staged: 1, processed: 1, reconciled: 0, blocked: 0 });
    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith('entry-1');
  });
});
