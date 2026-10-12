import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("chatbot document security boundaries", () => {
  test("new runtime path has no financial, signature, order or accounting dependency", () => {
    const paths = [
      "supabase/functions/_shared/chatbot/assets.js", "supabase/functions/_shared/chatbot/deliver-attachment.js",
      "supabase/functions/_shared/chatbot/process-event.js", "supabase/functions/_shared/chatbot/repository.js",
      "supabase/functions/whatsapp-webhook/sender.js", "supabase/functions/whatsapp-webhook/index.ts",
    ];
    for (const path of paths) {
      const source = read(path);
      expect(source).not.toMatch(/(?:from\s*|import\s*)["'][^"']*(?:pelecard|payper|rivhit|payment|accounting|order-signature)/i);
      expect(source).not.toMatch(/\.from\(["'](?:orders|quotes|payments|accounting|sales|signatures)/i);
    }
  });
  test("private assets are never converted into public or signed customer URLs", () => {
    for (const path of ["supabase/functions/_shared/chatbot/assets.js", "supabase/functions/whatsapp-webhook/sender.js"]) {
      expect(read(path)).not.toMatch(/getPublicUrl|createSignedUrl|console\.(?:log|error)|\blink\s*:/);
    }
    const sql = read("supabase/migrations/202610120001_chatbot_document_delivery.sql");
    expect(sql).toContain("'chatbot-assets', 'chatbot-assets', false");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
    expect(sql).not.toMatch(/(?:ALTER|UPDATE|INSERT INTO|DELETE FROM)\s+(?:public\.)?(?:orders|payments|accounting|sales)/i);
  });
  test("asset binary ignore rule is local to the supplied directory", () => {
    expect(read("docs/chatbot/chatbot-assets/.gitignore")).toContain("*.pdf");
    expect(read("docs/chatbot/chatbot-assets/.gitignore")).toContain("*.jpeg");
    expect(fileURLToPath(new URL("../../../docs/chatbot/chatbot-assets/.gitignore", import.meta.url))).toContain("chatbot-assets");
  });
});
