import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { approvedContent as sharedContent } from "../../../supabase/functions/_shared/chatbot/content.js";
import { advance as sharedAdvance, createSession } from "../../../supabase/functions/_shared/chatbot/state-machine.js";
import { approvedContent as deployedContent } from "../../../supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/content.js";
import { advance as deployedAdvance } from "../../../supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/state-machine.js";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
describe("canonical chatbot release bundle", () => {
  test.each(["assets.js", "assets.json", "deliver-attachment.js", "content-schema.js", "content.js", "process-event.js", "repository.js", "state-machine.js", ...["activities", "faq", "handoff", "menus", "policies", "profile", "safety", "sites"].map((name) => `content/v1/he/${name}.json`)])("deployed %s matches shared implementation", (path) => {
    expect(read(`supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/${path}`).replaceAll("\r\n", "\n")).toBe(read(`supabase/functions/_shared/chatbot/${path}`).replaceAll("\r\n", "\n"));
  });
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9])("deployed topic %s emits the same attachment and state", (choice) => {
    const session = { ...createSession(), currentState: "menu.corporate_topics" };
    const input = { text: String(choice) };
    expect(deployedAdvance({ content: deployedContent, session, input })).toEqual(sharedAdvance({ content: sharedContent, session, input }));
  });
  test("webhook retains canonical bundled imports and migration identifiers are unique", () => {
    const entry = read("supabase/functions/whatsapp-webhook/index.ts");
    expect(entry).toContain('./_deployed_shared/chatbot/assets.js');
    expect(entry).toContain('./_deployed_shared/chatbot/process-event.js');
    expect(entry).not.toContain('../_shared/chatbot/');
    const migrations = readdirSync(new URL("../../../supabase/migrations/", import.meta.url)).filter((file) => file.endsWith(".sql"));
    expect(migrations).toContain("046_quotation_lifecycle.sql");
    expect(migrations).toContain("202610120001_chatbot_document_delivery.sql");
    expect(migrations).not.toContain("046_chatbot_document_delivery.sql");
    expect(new Set(migrations.map((file) => file.split("_")[0])).size).toBe(migrations.length);
  });
});
