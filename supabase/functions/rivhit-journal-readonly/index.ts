import { createClient } from 'npm:@supabase/supabase-js@2.106.1';
import { RivhitClient } from '../_shared/rivhit/client.ts';
import { createRivhitReadOnlyHandler } from '../_shared/rivhit-journal/readonly.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const token = Deno.env.get('RIVHIT_API_TOKEN') ?? '';

const handler = createRivhitReadOnlyHandler({
  async authorize(jwt) {
    if (!url || !anonKey) return null;
    const client = createClient(url, anonKey, {
      global: { headers: { authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error } = await client.auth.getUser(jwt);
    if (error || !user) return null;
    const profile = await client.from('profiles').select('role').eq('id', user.id).single();
    if (profile.error || !profile.data) return null;
    return String(profile.data.role);
  },
  provider: {
    sortCodeList: () => new RivhitClient({ apiToken: token }).sortCodeList(),
    journalsReport: date => new RivhitClient({ apiToken: token }).journalsReport(date),
  },
});
Deno.serve(handler);
