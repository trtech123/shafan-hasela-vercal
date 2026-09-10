import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(process.cwd(), "../supabase/migrations/028_clubs_operational_rules.sql");

describe("migration 028 Clubs operational contract", () => {
  test("makes iCredit authoritative with fixed current-month billing on day 15", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/billing_day[^\n]+CHECK \(billing_day = 15\)/i);
    expect(sql).toMatch(/billing_month/i);
    expect(sql).toMatch(/provider_authoritative[^\n]+TRUE/i);
    expect(sql).not.toMatch(/rivhit/i);
    expect(sql).not.toMatch(/prorat/i);
  });

  test("creates one idempotent failed-payment follow-up", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/club_payment_follow_ups/i);
    expect(sql).toMatch(/UNIQUE\s*\(recurring_charge_id\)/i);
    expect(sql).toMatch(/ON CONFLICT\s*\(recurring_charge_id\)\s*DO NOTHING/i);
    expect(sql).toMatch(/EXECUTE FUNCTION public\.update_updated_at\(\)/i);
    expect(sql).not.toMatch(/EXECUTE FUNCTION public\.set_updated_at\(\)/i);
  });

  test("keeps attendance payment display derived and not editable", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/club_attendance_operations/i);
    expect(sql).toMatch(/'settled'/i);
    expect(sql).toMatch(/'failed'/i);
    expect(sql).toMatch(/'unknown'/i);
  });

  test("calculates deterministic cancellation boundaries and leaves freeze unchanged", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/EXTRACT\(DAY FROM p_requested_on\).*<= 10/is);
    expect(sql).toMatch(/INTERVAL '2 months'/i);
    expect(sql).not.toMatch(/freeze/i);
  });
});
