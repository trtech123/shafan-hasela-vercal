// Authenticated WhatsApp Cloud API adapter.
// Supported modes: text, free-form document, and approved Utility template.
// Required project secrets: META_WHATSAPP_TOKEN, META_PHONE_NUMBER_ID, META_WABA_ID.
// Deploy with JWT verification enabled (never use --no-verify-jwt).

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { authorizeCaller } from "./authorization.js";
import { createWhatsAppHandler } from "./handler.js";

const handler = createWhatsAppHandler({
  getEnv: (name: string) => Deno.env.get(name),
  fetchImpl: fetch,
  logger: console,
  authorize: (request: Request) => authorizeCaller({
    request,
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    anonKey: Deno.env.get("SUPABASE_ANON_KEY"),
    createClientImpl: createClient,
  }),
});

Deno.serve(handler);
