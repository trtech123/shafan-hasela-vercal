import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContentBundle } from "../../../supabase/functions/_shared/chatbot/content-schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const fileNames = [
  "profile.json",
  "menus.json",
  "sites.json",
  "activities.json",
  "policies.json",
  "safety.json",
  "faq.json",
  "handoff.json",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadBundle(root) {
  return Object.fromEntries(fileNames.map((name) => [
    name.replace(".json", ""),
    readJson(resolve(root, name)),
  ]));
}

const documentedRoot = resolve(here, "../../../docs/chatbot/content/v1/he");
const runtimeRoot = resolve(here, "../../../supabase/functions/_shared/chatbot/content/v1/he");

describe("approved chatbot content contract", () => {
  test("runtime content is an exact structural copy of the approved documentation", () => {
    expect(loadBundle(runtimeRoot)).toEqual(loadBundle(documentedRoot));
  });

  test("validates versions, identifiers, and every menu transition", () => {
    expect(validateContentBundle(loadBundle(runtimeRoot))).toMatchObject({
      contentVersion: "client-doc-1.0-2026-07-he",
      menuCount: 7,
      responseCount: expect.any(Number),
    });
  });

  test("preserves the approved operational facts exactly", () => {
    const content = loadBundle(runtimeRoot);
    const acre = content.sites.sites.find((site) => site.id === "acre_extreme_park");

    expect(acre.hours.august).toBe("א׳–ה׳ 10:00–17:00 | ו׳ 10:00–13:00");
    expect(content.policies.cancellation.response)
      .toBe("עד 72 שעות — ללא חיוב. אחרי → חיוב 100%");
    expect(content.policies.pricing_and_booking.approved_non_price_facts).toEqual([
      "מחירים כוללים מע\"מ",
      "מינימום משתתפים לקבוצה: 30 משתתפים (אלא אם צוין אחרת)",
      "יש מחירים מיוחדים לתושבי טבריה",
      "יש לעדכן מספר סופי עד 48 שעות לפני הפעילות",
    ]);
    expect(content.handoff.response_commitment).toBe("תוך יום עסקים");
  });

  test("keeps unsupported details handoff-only and contains no specific currency answers", () => {
    const content = loadBundle(runtimeRoot);
    const sites = Object.fromEntries(content.sites.sites.map((site) => [site.id, site]));
    const serialized = JSON.stringify(content);

    expect(sites.nof_hagalil_zipline.handoff_only).toBe(true);
    expect(sites.via_ferrata.handoff_only).toBe(true);
    expect(content.policies.pricing_and_booking.specific_price_behavior).toBe("handoff_only");
    expect(serialized).not.toMatch(/₪|ש"ח|\d[\d.,]*\s*שקל(?:ים)?/u);
  });
});
