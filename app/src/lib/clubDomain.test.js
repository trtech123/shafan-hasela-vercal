import { describe, expect, test } from "vitest";
import {
  buildMembershipRegistration,
  normalizeClubPayload,
  validateScheduleRules,
} from "./clubDomain";

describe("club domain helpers", () => {
  test("normalizes multiple independent weekly schedule rules", () => {
    const rules = validateScheduleRules([
      { weekday: "1", start_time: "16:00", end_time: "17:30", effective_from: "2026-09-01", effective_until: "" },
      { weekday: 4, start_time: "17:00", end_time: "18:00", effective_from: "", effective_until: "" },
    ]);

    expect(rules).toEqual([
      { weekday: 1, start_time: "16:00", end_time: "17:30", effective_from: "2026-09-01", effective_until: null, timezone: "Asia/Jerusalem", is_active: true },
      { weekday: 4, start_time: "17:00", end_time: "18:00", effective_from: null, effective_until: null, timezone: "Asia/Jerusalem", is_active: true },
    ]);
  });

  test("rejects invalid time and effective-date ranges", () => {
    expect(() => validateScheduleRules([
      { weekday: 2, start_time: "18:00", end_time: "17:00" },
    ])).toThrow(/end time/i);

    expect(() => validateScheduleRules([
      { weekday: 2, start_time: "17:00", end_time: "18:00", effective_from: "2026-10-01", effective_until: "2026-09-01" },
    ])).toThrow(/effective date/i);
  });

  test("normalizes club price, capacity, billing day, and rules", () => {
    const result = normalizeClubPayload({
      name: "  חוג נוער  ",
      description: " טיפוס שבועי ",
      instructor_id: "",
      site: "עכו",
      capacity: "14",
      monthly_price: "245.50",
      default_billing_day: "12",
      status: "active",
      notes: "",
      schedule_rules: [{ weekday: 1, start_time: "16:00", end_time: "17:30" }],
    });

    expect(result.club).toMatchObject({
      name: "חוג נוער",
      description: "טיפוס שבועי",
      instructor_id: null,
      capacity: 14,
      monthly_price: 245.5,
      default_billing_day: 12,
      currency: "ILS",
    });
    expect(result.rules).toHaveLength(1);
  });

  test("creates a participant and membership with an immutable price snapshot", () => {
    const club = { id: "club-1", monthly_price: 245, default_billing_day: 12 };
    const registration = buildMembershipRegistration({
      first_name: "נועה",
      last_name: "לוי",
      birth_date: "",
      phone: "",
      email: "",
      primary_contact_name: "רונית לוי",
      primary_contact_relationship: "אמא",
      primary_contact_phone: "0501234567",
      primary_contact_email: "parent@example.com",
      starts_on: "2026-10-01",
      monthly_price: "245",
      billing_day: "12",
      notes: "",
    }, club);

    expect(registration.participant).toMatchObject({
      first_name: "נועה",
      last_name: "לוי",
      primary_contact_name: "רונית לוי",
    });
    expect(registration.membership).toMatchObject({
      club_id: "club-1",
      monthly_price: 245,
      billing_day: 12,
      status: "pending_enrollment",
      payment_status: "not_enrolled",
    });

    club.monthly_price = 310;
    expect(registration.membership.monthly_price).toBe(245);
  });

  test("uses club defaults when registration does not override price or billing day", () => {
    const registration = buildMembershipRegistration({
      first_name: "דן",
      last_name: "כהן",
      starts_on: "2026-10-01",
      monthly_price: "",
      billing_day: "",
    }, { id: "club-2", monthly_price: 199, default_billing_day: 5 });

    expect(registration.membership.monthly_price).toBe(199);
    expect(registration.membership.billing_day).toBe(5);
  });
});
