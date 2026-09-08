import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

describe("WhatsApp endpoint separation contract", () => {
  test("makes only the inbound webhook public and keeps send-whatsapp JWT protected", () => {
    const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
    expect(config).toMatch(/\[functions\.whatsapp-webhook\][\s\S]*verify_jwt\s*=\s*false/i);
    expect(config).toMatch(/\[functions\.send-whatsapp\][\s\S]*verify_jwt\s*=\s*true/i);
  });

  test("uses Meta verification for inbound and does not import the authenticated staff handler", () => {
    const inbound = readFileSync(resolve(root, "supabase/functions/whatsapp-webhook/index.ts"), "utf8");
    const outbound = readFileSync(resolve(root, "supabase/functions/send-whatsapp/index.ts"), "utf8");

    expect(inbound).toContain("META_WEBHOOK_VERIFY_TOKEN");
    expect(inbound).toContain("META_APP_SECRET");
    expect(inbound).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(inbound).not.toMatch(/send-whatsapp|authorizeCaller/);
    expect(outbound).toContain("authorizeCaller");
  });
});
