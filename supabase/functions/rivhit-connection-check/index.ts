// Temporary, fixed-operation, service-only read probe. Deploy only after separate approval.
import { createConnectionCheckHandler } from '../_shared/rivhit-connection-check/handler.ts';

Deno.serve(createConnectionCheckHandler({
  apiToken: Deno.env.get('RIVHIT_API_TOKEN'),
  pilotPaymentId: Deno.env.get('RIVHIT_PROBE_PAYMENT_ID'),
}));
