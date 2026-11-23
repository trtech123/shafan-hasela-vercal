// Disabled until a verified landing form is configured to send signed requests.
// No service-role credential is sent to the landing page or CRM frontend.
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { createLandingLeadHandler } from './handler.js';
import { createLandingLeadRepository } from './repository.js';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const client = url && key ? createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
}) : null;
const repository = client ? createLandingLeadRepository(client) : null;
const list = (value: string | undefined) => (value ?? '').split(',').map(x => x.trim()).filter(Boolean);

Deno.serve(createLandingLeadHandler({
  enabled: Deno.env.get('LANDING_LEADS_ENABLED') === 'true',
  secret: Deno.env.get('LANDING_LEADS_WEBHOOK_SECRET'),
  allowedForms: list(Deno.env.get('LANDING_LEADS_ALLOWED_FORM_IDS')),
  allowedHosts: list(Deno.env.get('LANDING_LEADS_ALLOWED_HOSTS')).map(host => host.toLowerCase()),
  ingest: repository?.ingest ?? null,
}));
