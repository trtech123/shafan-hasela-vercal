import { describe, expect, test } from "vitest";
import { approvedContent, resolveResponse } from "../../../supabase/functions/_shared/chatbot/content.js";

describe("approved response resolver", () => {
  test("renders all menu options as deterministic numbered text", () => {
    expect(resolveResponse(approvedContent, "menu.main")).toBe([
      "במה אוכל לעזור לך היום?",
      "1. פעילויות ומתקנים",
      "2. ימי גיבוש לחברות / קבוצות",
      "3. מחירים והזמנה",
      "4. הגעה לאתר",
      "5. בטיחות ומגבלות",
      "6. חוגי טיפוס ונבחרות",
      "7. שאלות נפוצות",
    ].join("\n"));
  });

  test("resolves every response identifier emitted by the state machine", () => {
    const ids = [
      "policy.welcome",
      "policy.corporate.overview",
      "policy.corporate.offerings",
      "policy.corporate.after_group_selection",
      "policy.pricing",
      "handoff.transfer",
      ...approvedContent.menus.menus.map((menu) => `menu.${menu.id}`),
      ...approvedContent.activities.activities.map((activity) => `activity.${activity.id}`),
      ...approvedContent.safety.answers.map((answer) => `safety.${answer.id}`),
      ...approvedContent.faq.entries.map((entry) => `faq.${entry.id}`),
      "site.berko_360_tiberias.overview",
      "site.field_activities.overview",
      "site.acre_extreme_park.directions",
      "site.berko_360_tiberias.directions",
    ];

    for (const id of ids) expect(resolveResponse(approvedContent, id), id).toBeTruthy();
  });

  test("pricing response contains approved policy facts but no specific amount", () => {
    const response = resolveResponse(approvedContent, "policy.pricing");
    expect(response).toContain("מחירים כוללים מע\"מ");
    expect(response).toContain("30 משתתפים");
    expect(response).toContain("48 שעות");
    expect(response).not.toMatch(/₪|ש"ח|\d[\d.,]*\s*שקל(?:ים)?/u);
  });

  test("fails closed for an unregistered response identifier", () => {
    expect(() => resolveResponse(approvedContent, "orders.total"))
      .toThrow("Unknown chatbot response: orders.total");
  });
});
