import { describe, expect, test } from "vitest";
import { findConflictingBlocks, findConflictingOrders } from "./blocking";

const proposed = { activity_date: "2026-11-10", start_time: "10:00", end_time: "11:00", site: "עכו", instructor_id: "i1" };
const row = (overrides = {}) => ({ id: "other", status: "מאושר", ...proposed, start_time: "10:30:00", end_time: "11:30:00", ...overrides });

describe("order overlap warning", () => {
  test("warns for a shared site or instructor, including on edit without self", () => {
    const rows = [row(), row({ id: "shared-instructor", site: "טבריה" }), row({ id: "self" })];
    expect(findConflictingOrders(rows, proposed, "self").map((r) => r.id)).toEqual(["other", "shared-instructor"]);
  });
  test("ignores different dates, unrelated sites, cancelled and adjacent slots", () => {
    const rows = [row({ activity_date: "2026-11-11" }), row({ site: "טבריה", instructor_id: "i2" }), row({ status: "בוטל" }), row({ start_time: "11:00", end_time: "12:00" })];
    expect(findConflictingOrders(rows, proposed)).toEqual([]);
  });
  test("does not invent a conflict for an incomplete time range", () => {
    expect(findConflictingOrders([row()], { ...proposed, end_time: null })).toEqual([]);
  });
  test('keeps the existing site-specific and global blocked-slot rules', () => {
    const block = (site) => ({ block_date: proposed.activity_date, site, start_time: '10:30', end_time: '11:30' });
    expect(findConflictingBlocks([block('עכו'), block('טבריה'), block(null)], { date: proposed.activity_date, site: 'עכו', start_time: '10:00', end_time: '11:00' })).toHaveLength(2);
  });
});
