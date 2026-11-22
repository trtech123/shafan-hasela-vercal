import type { JournalMapping, JournalSourceRow } from './mapper.ts';

interface BatchStore {
  listUnmapped(limit: number): Promise<JournalSourceRow[]>;
  stage(source: JournalSourceRow, mapping: JournalMapping): Promise<string>;
  defer(sourceId: string): Promise<void>;
  listReady(limit: number): Promise<string[]>;
  listPending(limit: number): Promise<string[]>;
}

/** Cron is a wake-up only. Database uniqueness and atomic reservation own idempotency. */
export async function runRivhitJournalBatch(dependencies: {
  store: BatchStore;
  process: (entryId: string) => Promise<string>;
  reconcile: (entryId: string) => Promise<string>;
  mappings: JournalMapping[];
  ingestionEnabled: boolean;
  postingEnabled: boolean;
}): Promise<{ staged: number; processed: number; reconciled: number; blocked: number }> {
  let staged = 0, processed = 0, reconciled = 0, blocked = 0;
  if (dependencies.ingestionEnabled) {
    const sources = await dependencies.store.listUnmapped(10);
    for (const source of sources) {
      const applicable = dependencies.mappings.filter(
        mapping => mapping.provider === source.source_facts.provider
          && mapping.site === (source.source_facts.site ?? null));
      if (applicable.length !== 1) {
        await dependencies.store.defer(source.id);
        blocked++;
        continue;
      }
      try {
        await dependencies.store.stage(source, applicable[0]);
        staged++;
      } catch {
        // A failed or conflicting stage is visible in the source queue; never post it.
        await dependencies.store.defer(source.id);
        blocked++;
      }
    }
  }
  if (dependencies.postingEnabled) {
    const ready = await dependencies.store.listReady(10);
    for (const id of ready) {
      try { await dependencies.process(id); processed++; }
      catch { blocked++; }
    }
  }
  if (dependencies.ingestionEnabled || dependencies.postingEnabled) {
    for (const id of await dependencies.store.listPending(10)) {
      try { await dependencies.reconcile(id); reconciled++; }
      catch { blocked++; }
    }
  }
  return { staged, processed, reconciled, blocked };
}
