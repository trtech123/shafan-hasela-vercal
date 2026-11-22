import { createClient } from 'npm:@supabase/supabase-js@2.106.1';
import { RivhitClient } from '../_shared/rivhit/client.ts';
import { createRivhitReadOnlyHandler } from '../_shared/rivhit-journal/readonly.ts';
import { authorizeRivhitUser } from './authorization.js';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const token = Deno.env.get('RIVHIT_API_TOKEN') ?? '';

const handler = createRivhitReadOnlyHandler({
  async authorize(jwt) {
    return authorizeRivhitUser(jwt, { url, anonKey, createClient });
  },
  provider: {
    sortCodeList: () => new RivhitClient({ apiToken: token }).sortCodeList(),
    journalsReport: date => new RivhitClient({ apiToken: token }).journalsReport(date),
  },
});
Deno.serve(handler);
