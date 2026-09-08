// Authenticated staff-only handoff controls. JWT verification remains enabled.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { createWhatsAppSender } from "../whatsapp-webhook/sender.js";
import { authorizeHandoffStaff } from "./authorization.js";
import { createHandoffAdminHandler } from "./handler.js";
import { createHandoffOperations } from "./operations.js";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const serviceClient = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
const sender = createWhatsAppSender({
  token: Deno.env.get("META_WHATSAPP_TOKEN"),
  phoneNumberId: Deno.env.get("META_PHONE_NUMBER_ID"),
  fetchImpl: fetch,
});
const operations = serviceClient
  ? createHandoffOperations({ serviceSupabase: serviceClient, sender })
  : null;

const handler = createHandoffAdminHandler({
  authorize: (request: Request) => authorizeHandoffStaff({
    request,
    supabaseUrl,
    anonKey,
    createClientImpl: createClient,
  }),
  operations: operations ?? new Proxy({}, {
    get: () => async () => { throw new Error("handoff_service_not_configured"); },
  }),
});

Deno.serve(handler);
