import { createClient } from 'npm:@supabase/supabase-js@2.106.1';
import { RivhitClient } from '../_shared/rivhit/client.ts';
import { createRivhitJournalHandler } from '../_shared/rivhit-journal/handler.ts';
import { processRivhitJournal } from '../_shared/rivhit-journal/processor.ts';
import { SupabaseRivhitJournalStore } from '../_shared/rivhit-journal/repository.ts';

const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const enabled = Deno.env.get('RIVHIT_JOURNAL_POSTING_ENABLED') === 'true';
const handler = createRivhitJournalHandler({
  serviceKey,
  enabled: enabled && !!serviceKey && !!Deno.env.get('RIVHIT_API_TOKEN'),
  async process(entryId) {
    const url = Deno.env.get('SUPABASE_URL');
    const token = Deno.env.get('RIVHIT_API_TOKEN');
    if (!url || !token) throw new Error('journal_configuration_missing');
    const serviceClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return processRivhitJournal(entryId, {
      store: new SupabaseRivhitJournalStore(serviceClient),
      provider: new RivhitClient({ apiToken: token }),
    });
  },
});

Deno.serve(handler);
