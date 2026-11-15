// Temporary, fixed-operation, service-only read probe. Deploy only after separate approval.
import { createConnectionCheckHandler } from '../_shared/rivhit-connection-check/handler.ts';

Deno.serve(createConnectionCheckHandler({
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  apiToken: Deno.env.get('RIVHIT_API_TOKEN'),
}));
