import { mapJournalSource, type JournalMapping, type JournalSourceRow } from './mapper.ts';
import type { RivhitJournalDraft } from '../rivhit/types.ts';

async function hash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function mapDailyJournalBatch(sources: JournalSourceRow[],
  mapping: JournalMapping, batchId: string, postingDay: string) {
  if (sources.length < 1 || sources.length > 500
    || new Set(sources.map(source => source.id)).size !== sources.length
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)
    || !/^\d{4}-\d{2}-\d{2}$/.test(postingDay)
    || new Date(`${postingDay}T00:00:00Z`).toISOString().slice(0, 10) !== postingDay)
    throw new Error('daily_batch_invalid');
  const mapped = await Promise.all(sources.map(source => mapJournalSource(source, mapping)));
  if (new Set(mapped.map(item => item.mappingVersion)).size !== 1)
    throw new Error('daily_mapping_conflict');
  const grossMinor = mapped.reduce((sum, item) => sum + Math.round(item.draft.amount * 100), 0);
  const vatMinor = mapped.reduce((sum, item) => sum + Math.round(item.expectedVat * 100), 0);
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 1 || !Number.isSafeInteger(vatMinor))
    throw new Error('daily_amount_invalid');
  const [year, month, day] = postingDay.split('-');
  const draft: RivhitJournalDraft = {
    sort_code: mapping.sortCode,
    customer_id_debit: mapping.debitAccount,
    customer_id_credit: mapping.creditAccount,
    amount: grossMinor / 100,
    reference_date: `${day}${month}${year}`,
    reference1: batchId,
    reference2: `SF-${batchId}`,
    request_reference: `shafan:daily:${batchId}`,
    ...(mapping.projectId === undefined ? {} : { project_id: mapping.projectId }),
  };
  return { batchId, postingDay, sourceIds: sources.map(source => source.id),
    mappingVersion: mapped[0].mappingVersion, draft,
    payloadHash: await hash(draft), expectedVat: vatMinor / 100 };
}

interface DailyStore {
  closingWindowOpen(): Promise<string | null>;
  listUnmapped(limit: number): Promise<JournalSourceRow[]>;
  defer(sourceId: string): Promise<void>;
  stageDaily(sources: JournalSourceRow[], mapping: JournalMapping,
    batchId: string, postingDay: string): Promise<string>;
  listReady(limit: number): Promise<string[]>;
  listPending(limit: number): Promise<string[]>;
}

/** Every run is bounded. Database locks, membership uniqueness and reservation
 *  own idempotency; an uncertain AddJournal result is read back, never retried. */
export async function runDailyRivhitBatch(dependencies: {
  store: DailyStore;
  process: (id: string) => Promise<string>;
  reconcile: (id: string) => Promise<string>;
  mappings: JournalMapping[];
  ingestionEnabled: boolean;
  postingEnabled: boolean;
  uuid?: () => string;
}): Promise<{ staged: number; processed: number; reconciled: number; blocked: number }> {
  const result = { staged: 0, processed: 0, reconciled: 0, blocked: 0 };
  const postingDay = dependencies.ingestionEnabled || dependencies.postingEnabled
    ? await dependencies.store.closingWindowOpen() : null;
  if (dependencies.ingestionEnabled && postingDay) {
    const sources = await dependencies.store.listUnmapped(500);
    const groups = new Map<string, { mapping: JournalMapping; sources: JournalSourceRow[] }>();
    for (const source of sources) {
      const candidates = dependencies.mappings.filter(mapping =>
        mapping.site === source.source_facts.site
          && mapping.provider === source.source_facts.provider);
      if (candidates.length !== 1) {
        await dependencies.store.defer(source.id);
        result.blocked++;
        continue;
      }
      try { await mapJournalSource(source, candidates[0]); }
      catch {
        await dependencies.store.defer(source.id);
        result.blocked++;
        continue;
      }
      const key = `${candidates[0].provider}:${candidates[0].site}`;
      if (!groups.has(key)) groups.set(key, { mapping: candidates[0], sources: [] });
      groups.get(key)!.sources.push(source);
    }
    for (const group of [...groups.values()].slice(0, 10)) {
      try {
        await dependencies.store.stageDaily(group.sources, group.mapping,
          (dependencies.uuid ?? crypto.randomUUID)(), postingDay);
        result.staged++;
      } catch {
        // No retry of an unknown provider result occurs here. A lost staging
        // response is resolved by source membership on the next scheduled run.
        for (const source of group.sources) await dependencies.store.defer(source.id);
        result.blocked++;
      }
    }
  }
  if (dependencies.postingEnabled && postingDay) {
    for (const id of await dependencies.store.listReady(10)) {
      try { await dependencies.process(id); result.processed++; }
      catch { result.blocked++; }
    }
  }
  if (dependencies.ingestionEnabled || dependencies.postingEnabled) {
    for (const id of await dependencies.store.listPending(10)) {
      try { await dependencies.reconcile(id); result.reconciled++; }
      catch { result.blocked++; }
    }
  }
  return result;
}
