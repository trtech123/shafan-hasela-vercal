import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "../../../supabase/migrations/026_chatbot_runtime.sql");

function sql() {
  return readFileSync(migrationPath, "utf8");
}

describe("chatbot runtime migration contract", () => {
  test("creates isolated runtime tables starting at migration 026", () => {
    const source = sql();
    for (const table of ["bot_contacts", "bot_conversations", "bot_messages", "bot_channel_events", "bot_handoffs"]) {
      expect(source).toMatch(new RegExp(`CREATE TABLE public\\.${table}\\b`, "i"));
      expect(source).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
    }
  });

  test("enforces provider identity, replay, status, direction, and content-version constraints", () => {
    const source = sql();
    expect(source).toMatch(/UNIQUE\s*\(channel, external_contact_id\)/i);
    expect(source).toMatch(/UNIQUE\s*\(channel, provider_event_id\)/i);
    expect(source).toMatch(/CREATE UNIQUE INDEX bot_messages_provider_message_unique[\s\S]*ON public\.bot_messages\(channel, provider_message_id\)[\s\S]*WHERE provider_message_id IS NOT NULL/i);
    expect(source).toMatch(/CHECK\s*\(status IN \('automated', 'awaiting_human', 'human_active', 'resolved', 'closed'\)\)/i);
    expect(source).toMatch(/CHECK\s*\(direction IN \('inbound', 'outbound'\)\)/i);
    expect(source).toMatch(/content_version\s+TEXT NOT NULL/i);
    expect(source).toMatch(/verification_source\s+TEXT NOT NULL/i);
    expect(source).toMatch(/verified_at\s+TIMESTAMPTZ NOT NULL/i);
    expect(source).not.toMatch(/raw_payload|authorization_header|app_secret|access_token/i);
  });

  test("provides atomic event and handoff operations with narrow grants", () => {
    const source = sql();
    expect(source).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_bot_channel_event/i);
    expect(source).toMatch(/ON CONFLICT \(channel, provider_event_id\) DO NOTHING/i);
    expect(source).toMatch(/CREATE OR REPLACE FUNCTION public\.create_bot_handoff/i);
    expect(source).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_bot_handoff/i);
    expect(source).toMatch(/status = 'human_active'/i);
    expect(source).toMatch(/CREATE OR REPLACE FUNCTION public\.resume_bot_conversation/i);
    expect(source).toMatch(/current_state = 'menu\.main'/i);
    expect(source).toMatch(/CREATE OR REPLACE FUNCTION public\.resolve_bot_handoff/i);
    expect(source).toMatch(/CREATE OR REPLACE FUNCTION public\.close_bot_handoff/i);
    expect(source).toMatch(/REVOKE ALL ON FUNCTION public\.claim_bot_channel_event[\s\S]*FROM PUBLIC, anon, authenticated/i);
    expect(source).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_bot_channel_event[\s\S]*TO service_role/i);
  });

  test("allows only admin/operations staff visibility and keeps writes behind functions", () => {
    const source = sql();
    expect(source.match(/USING \(public\.is_admin_or_ops\(\)\)/gi)?.length).toBeGreaterThanOrEqual(5);
    expect(source).toMatch(/REVOKE ALL ON public\.bot_contacts, public\.bot_conversations, public\.bot_messages, public\.bot_channel_events, public\.bot_handoffs FROM PUBLIC, anon, authenticated/i);
    expect(source).toMatch(/GRANT SELECT ON public\.bot_contacts, public\.bot_conversations, public\.bot_messages, public\.bot_channel_events, public\.bot_handoffs TO authenticated/i);
    expect(source).not.toMatch(/CREATE POLICY[\s\S]{0,120}FOR (?:INSERT|UPDATE|DELETE)/i);
  });

  test("links only handoffs to CRM leads and never links bot runtime to protected business domains", () => {
    const source = sql();
    expect(source).toMatch(/lead_id\s+UUID REFERENCES public\.leads\(id\)/i);
    expect(source).toMatch(/INSERT INTO public\.leads/i);
    expect(source).not.toMatch(/REFERENCES public\.(?:orders|quotes|clubs|club_|sales|payment_|accounting_|recurring_)/i);
  });

  test("indexes active conversations, provider messages, handoff queue, and retryable events", () => {
    const source = sql();
    expect(source).toMatch(/CREATE UNIQUE INDEX bot_conversations_one_active/i);
    expect(source).toMatch(/CREATE UNIQUE INDEX bot_messages_provider_message_unique/i);
    expect(source).toMatch(/CREATE INDEX bot_handoffs_queue_idx/i);
    expect(source).toMatch(/CREATE INDEX bot_channel_events_retry_idx/i);
  });
});
