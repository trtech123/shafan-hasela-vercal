// Public Meta WhatsApp webhook.
// JWT verification is disabled only for this endpoint; every POST is verified
// against X-Hub-Signature-256 before JSON parsing or persistence.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { createChatbotRepository } from "../_shared/chatbot/repository.js";
import { processVerifiedEvent } from "../_shared/chatbot/process-event.js";
import { createWhatsAppWebhookHandler } from "./handler.js";
import { createWhatsAppSender } from "./sender.js";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const client = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

const repository = client ? createChatbotRepository(client) : null;
const sender = createWhatsAppSender({
  token: Deno.env.get("META_WHATSAPP_TOKEN"),
  phoneNumberId: Deno.env.get("META_PHONE_NUMBER_ID"),
  fetchImpl: fetch,
});

const handler = createWhatsAppWebhookHandler({
  appSecret: Deno.env.get("META_APP_SECRET"),
  verifyToken: Deno.env.get("META_WEBHOOK_VERIFY_TOKEN"),
  processEvent: async (event) => {
    if (!repository) throw new Error("chatbot_repository_not_configured");
    return processVerifiedEvent({ event, repository, sender });
  },
});

Deno.serve(handler);
