import { createClient } from 'npm:@supabase/supabase-js@2.106.1';
import { RivhitClient } from '../_shared/rivhit/client.ts';
import { createRivhitJournalHandler } from '../_shared/rivhit-journal/handler.ts';
import { processRivhitJournal } from '../_shared/rivhit-journal/processor.ts';
import { SupabaseRivhitJournalStore } from '../_shared/rivhit-journal/repository.ts';
import { runDailyRivhitBatch } from '../_shared/rivhit-journal/daily.ts';
import type { JournalMapping } from '../_shared/rivhit-journal/mapper.ts';
import { reconcileRivhitJournal } from '../_shared/rivhit-journal/reconcile.ts';

const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const postingEnabled = Deno.env.get('RIVHIT_JOURNAL_POSTING_ENABLED') === 'true';
const ingestionEnabled = Deno.env.get('RIVHIT_JOURNAL_INGESTION_ENABLED') === 'true';
function runtime() {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url || !serviceKey) throw new Error('journal_configuration_missing');
  return new SupabaseRivhitJournalStore(createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }));
}
function mappings(): JournalMapping[] {
  const raw = Deno.env.get('RIVHIT_JOURNAL_MAPPINGS_JSON');
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 20) throw new Error('journal_mapping_invalid');
  return parsed as JournalMapping[];
}
async function process(entryId: string, store = runtime()) {
  const token = Deno.env.get('RIVHIT_API_TOKEN');
  if (!token) throw new Error('journal_configuration_missing');
  return processRivhitJournal(entryId, { store, provider: new RivhitClient({ apiToken: token }) });
}
async function reconcile(entryId: string, store = runtime()) {
  const token = Deno.env.get('RIVHIT_API_TOKEN');
  if (!token) throw new Error('journal_configuration_missing');
  return reconcileRivhitJournal(entryId, {
    store, provider: new RivhitClient({ apiToken: token }),
  });
}
const handler = createRivhitJournalHandler({
  serviceKey,
  enabled: postingEnabled && !!serviceKey && !!Deno.env.get('RIVHIT_API_TOKEN'),
  ingestionEnabled: ingestionEnabled && !!serviceKey,
  process,
  reconcile,
  async batch() {
    const store = runtime();
    const result = await runDailyRivhitBatch({ store, process: id => process(id, store),
      reconcile: id => reconcile(id, store),
      mappings: mappings(), ingestionEnabled, postingEnabled });
    return { ...result, overdue: await store.overdueCounts() };
  },
});

Deno.serve(handler);
