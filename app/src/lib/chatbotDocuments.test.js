import { describe, expect, test } from "vitest";
import { approvedContent as content } from "../../../supabase/functions/_shared/chatbot/content.js";
import { advance, createSession } from "../../../supabase/functions/_shared/chatbot/state-machine.js";

const run = (state, text) => advance({ content, session: { ...createSession(), currentState: state }, input: { text } });
const attachments = (result) => result.actions.filter((a) => a.type === "send_attachment");
const expected = ["carmel", "berko_day", "student_resilience", "elah", "wheels_acre", "springs", "heritage", "berko_treasure", "organizational_resilience"];

describe("explicit approved document selection", () => {
  test.each(expected.map((id, i) => [String(i + 1), id]))("corporate choice %s maps only to %s", (choice, id) => {
    const result = run("menu.corporate_topics", choice);
    expect(attachments(result)).toEqual([{ type: "send_attachment", assetId: id }]);
    expect(result.session.selectedActivity).toBe(id);
    expect(result.session.currentState).toBe("menu.corporate_group_size");
  });
  test("main corporate selection displays topics without sending a file", () => {
    const result = run("menu.main", "2");
    expect(result.session.currentState).toBe("menu.corporate_topics");
    expect(attachments(result)).toEqual([]);
  });
  test("Berko and Acre routes remain separate", () => {
    expect(run("menu.activities_sites", "2").session.currentState).toBe("menu.berko_topics");
    expect(attachments(run("menu.berko_topics", "1"))[0].assetId).toBe("berko_day");
    expect(attachments(run("menu.berko_topics", "2"))[0].assetId).toBe("berko_treasure");
    expect(run("menu.acre", "6").session.currentState).toBe("menu.acre_groups");
    expect(attachments(run("menu.acre_groups", "1"))[0].assetId).toBe("wheels_acre");
    expect(attachments(run("menu.acre_groups", "berko_treasure"))).toEqual([]);
    expect(attachments(run("menu.berko_topics", "wheels_acre"))).toEqual([]);
  });
  test.each(["menu.main", "menu.activities_sites", "menu.directions", "menu.safety", "menu.faq", "menu.corporate_group_size", "start"])("no topic injection from %s", (state) => {
    for (const id of expected) expect(attachments(run(state, id))).toEqual([]);
  });
  test("generic group selection and human commands still hand off without documents", () => {
    expect(run("menu.corporate_topics", "10").session.currentState).toBe("menu.corporate_group_size");
    expect(run("menu.corporate_group_size", "1").session.status).toBe("awaiting_human");
    expect(attachments(run("menu.corporate_group_size", "1"))).toEqual([]);
    expect(run("menu.corporate_topics", "נציג אנושי").session.status).toBe("awaiting_human");
  });
  test.each(["awaiting_human", "human_active"])("no attachments while %s", (status) => {
    expect(advance({ content, session: { ...createSession(), currentState: "menu.corporate_topics", status }, input: { text: "1" } }).actions).toEqual([]);
  });
  test("a stale interactive ID cannot fall back to a different numbered package", () => {
    const result = advance({ content, session: { ...createSession(), currentState: "menu.acre_groups" }, input: { optionId: "berko_treasure", text: "1" } });
    expect(attachments(result)).toEqual([]);
  });
  test("back and main menu navigation never delivers documents", () => {
    const chosen = run("menu.corporate_topics", "3");
    const back = advance({ content, session: chosen.session, input: { text: "חזרה" } });
    expect(back.session.currentState).toBe("menu.corporate_topics");
    expect(attachments(back)).toEqual([]);
    const main = advance({ content, session: chosen.session, input: { text: "תפריט" } });
    expect(main.session.currentState).toBe("menu.main");
    expect(attachments(main)).toEqual([]);
  });
  test("changing from Berko to general Acre groups clears the old package in handoff", () => {
    let result = run("menu.berko_topics", "2");
    for (const text of ["תפריט", "1", "1", "6", "2", "1"]) {
      result = advance({ content, session: result.session, input: { text } });
    }
    expect(result.session.selectedSite).toBe("acre_extreme_park");
    expect(result.session.selectedActivity).toBeNull();
    expect(result.session.collectedFields.requested_activity).toBeUndefined();
    expect(result.session.collectedFields.requested_site).toBe("acre_extreme_park");
  });
});
