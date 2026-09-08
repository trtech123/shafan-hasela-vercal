import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { advance, createSession } from "../../../supabase/functions/_shared/chatbot/state-machine.js";

const here = dirname(fileURLToPath(import.meta.url));
const contentRoot = resolve(here, "../../../supabase/functions/_shared/chatbot/content/v1/he");
const files = ["profile", "menus", "sites", "activities", "policies", "safety", "faq", "handoff"];
const content = Object.fromEntries(files.map((name) => [
  name,
  JSON.parse(readFileSync(resolve(contentRoot, `${name}.json`), "utf8")),
]));

function automated(state = "menu.main", parentState = null) {
  return { ...createSession(), currentState: state, parentState };
}

function responseIds(result) {
  return result.actions.filter((action) => action.type === "send").map((action) => action.responseId);
}

describe("deterministic chatbot state machine", () => {
  test("welcomes a new contact with the approved main menu", () => {
    const result = advance({ content, session: createSession(), input: { text: "שלום" } });

    expect(responseIds(result)).toEqual(["policy.welcome", "menu.main"]);
    expect(result.session.currentState).toBe("menu.main");
    expect(result.session.status).toBe("automated");
  });

  test.each([
    ["1", "menu.activities_sites", ["menu.activities_sites"]],
    ["2", "menu.corporate_group_size", ["policy.corporate.overview", "policy.corporate.offerings", "menu.corporate_group_size"]],
    ["3", "menu.main", ["policy.pricing", "handoff.transfer"]],
    ["4", "menu.directions", ["menu.directions"]],
    ["5", "menu.safety", ["menu.safety"]],
    ["6", "menu.main", ["handoff.transfer"]],
    ["7", "menu.faq", ["menu.faq"]],
  ])("handles main menu option %s", (text, expectedState, expectedResponses) => {
    const result = advance({ content, session: automated(), input: { text } });

    expect(result.session.currentState).toBe(expectedState);
    expect(responseIds(result)).toEqual(expectedResponses);
  });

  test.each([
    ["1", "menu.acre", ["menu.acre"]],
    ["2", "menu.activities_sites", ["site.berko_360_tiberias.overview"]],
    ["3", "menu.activities_sites", ["site.field_activities.overview"]],
  ])("navigates an approved activity site option %s", (text, expectedState, expectedResponses) => {
    const result = advance({ content, session: automated("menu.activities_sites", "menu.main"), input: { text } });

    expect(result.session.currentState).toBe(expectedState);
    expect(responseIds(result)).toEqual(expectedResponses);
  });

  test("hands off Nof HaGalil without inventing details", () => {
    const result = advance({ content, session: automated("menu.activities_sites", "menu.main"), input: { text: "4" } });

    expect(responseIds(result)).toEqual(["handoff.transfer"]);
    expect(result.session.status).toBe("awaiting_human");
    expect(result.actions).toContainEqual(expect.objectContaining({ type: "handoff", reason: "handoff_only_content" }));
  });

  test.each([
    ["1", "activity.acre_climbing"],
    ["2", "activity.acre_sky_trek"],
    ["3", "activity.acre_bungee_drop"],
    ["4", "activity.acre_zipline"],
    ["5", "activity.acre_kids"],
  ])("returns approved Acre activity %s", (text, responseId) => {
    const result = advance({ content, session: automated("menu.acre", "menu.activities_sites"), input: { text } });

    expect(responseIds(result)).toEqual([responseId]);
    expect(result.session.status).toBe("automated");
  });

  test("routes Acre events into the corporate flow", () => {
    const result = advance({ content, session: automated("menu.acre", "menu.activities_sites"), input: { text: "6" } });

    expect(responseIds(result)).toEqual(["policy.corporate.overview", "policy.corporate.offerings", "menu.corporate_group_size"]);
    expect(result.session.currentState).toBe("menu.corporate_group_size");
  });

  test.each([
    ["1", "small"],
    ["2", "medium"],
    ["3", "large"],
  ])("captures corporate group bucket %s and hands off", (text, bucket) => {
    const result = advance({ content, session: automated("menu.corporate_group_size", "menu.main"), input: { text } });

    expect(result.session.collectedFields.group_size_bucket).toBe(bucket);
    expect(result.session.status).toBe("awaiting_human");
    expect(responseIds(result)).toEqual(["policy.corporate.after_group_selection"]);
    expect(result.actions).toContainEqual(expect.objectContaining({ type: "handoff", reason: bucket === "large" ? "event_over_50" : "quote_request" }));
  });

  test.each([
    ["1", "site.acre_extreme_park.directions"],
    ["2", "site.berko_360_tiberias.directions"],
  ])("returns approved directions option %s", (text, responseId) => {
    const result = advance({ content, session: automated("menu.directions", "menu.main"), input: { text } });
    expect(responseIds(result)).toEqual([responseId]);
  });

  test("hands off directions absent from approved content", () => {
    const result = advance({ content, session: automated("menu.directions", "menu.main"), input: { text: "3" } });
    expect(result.session.status).toBe("awaiting_human");
    expect(result.actions).toContainEqual(expect.objectContaining({ type: "handoff", reason: "handoff_only_content" }));
  });

  test.each([
    ["1", "safety.weight"],
    ["2", "safety.health"],
    ["3", "safety.age"],
    ["4", "safety.equipment"],
    ["5", "safety.conduct"],
  ])("returns every approved safety answer %s", (text, responseId) => {
    const result = advance({ content, session: automated("menu.safety", "menu.main"), input: { text } });
    expect(responseIds(result)).toEqual([responseId]);
  });

  test.each([
    ["1", "faq.parking", false],
    ["2", "faq.rain", false],
    ["3", "faq.clothing", false],
    ["4", "faq.parent", true],
    ["5", "faq.cancellation", false],
    ["6", "faq.ticket", false],
    ["7", "faq.food", false],
  ])("returns every approved FAQ answer %s", (text, responseId, handsOff) => {
    const result = advance({ content, session: automated("menu.faq", "menu.main"), input: { text } });
    expect(responseIds(result)).toEqual(handsOff ? [responseId, "handoff.transfer"] : [responseId]);
    expect(result.session.status).toBe(handsOff ? "awaiting_human" : "automated");
  });

  test.each([
    ["משקל מקסימלי", "safety.weight"],
    ["האם אפשר בהריון?", "safety.health"],
    ["מה הגיל המינימלי?", "safety.age"],
    ["מקבלים רתמה?", "safety.equipment"],
    ["מה כללי ההתנהגות?", "safety.conduct"],
  ])("routes reviewed safety alias '%s' without generative inference", (text, responseId) => {
    const result = advance({ content, session: automated(), input: { text } });
    expect(responseIds(result)).toEqual([responseId]);
  });

  test.each([
    ["כמה עולה כרטיס?", "specific_price", "normal"],
    ["אני רוצה להתלונן על בעיה", "complaint_or_problem", "high"],
    ["תבנו לנו אירוע בהתאמה אישית", "complex_or_custom_package", "normal"],
    ["אירוע ל-65 משתתפים", "event_over_50", "normal"],
    ["נציג אנושי", "explicit_human_request", "normal"],
    ["שאלה שאין לה תשובה", "unknown_question", "normal"],
  ])("hands off explicit guarded input '%s'", (text, reason, priority) => {
    const result = advance({ content, session: automated(), input: { text } });
    expect(result.session.status).toBe("awaiting_human");
    expect(responseIds(result)).toEqual(["handoff.transfer"]);
    expect(result.actions).toContainEqual(expect.objectContaining({ type: "handoff", reason, priority, summary: text }));
  });

  test.each(["שלחו לי את אישור ההזמנה", "אני רוצה את אישור ההזמנה שלי"])(
    "keeps order confirmation intent behind a disabled secure boundary: %s",
    (text) => {
      const result = advance({ content, session: automated(), input: { text } });

      expect(result.actions).toContainEqual({ type: "request_secure_action", actionId: "resend_order_confirmation", availability: "handoff_only" });
      expect(result.actions).toContainEqual(expect.objectContaining({ type: "handoff", reason: "order_confirmation_unavailable" }));
      expect(result.session.status).toBe("awaiting_human");
    },
  );

  test("supports global menu, back, and exact interactive option identifiers", () => {
    const menu = advance({ content, session: automated("menu.safety", "menu.main"), input: { text: "תפריט" } });
    expect(menu.session.currentState).toBe("menu.main");
    expect(responseIds(menu)).toEqual(["menu.main"]);

    const back = advance({ content, session: automated("menu.safety", "menu.main"), input: { text: "חזרה" } });
    expect(back.session.currentState).toBe("menu.main");
    expect(responseIds(back)).toEqual(["menu.main"]);

    const interactive = advance({ content, session: automated(), input: { optionId: "activities" } });
    expect(interactive.session.currentState).toBe("menu.activities_sites");
  });

  test.each(["awaiting_human", "human_active"])("suppresses automation while %s", (status) => {
    const session = { ...automated(), status };
    const result = advance({ content, session, input: { text: "תפריט" } });

    expect(result.actions).toEqual([]);
    expect(result.session).toEqual(session);
  });
});
