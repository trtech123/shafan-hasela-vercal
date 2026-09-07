import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  here,
  "../../../supabase/migrations/021_clubs_and_recurring_billing.sql",
);

function migrationSql() {
  return readFileSync(migrationPath, "utf8");
}

describe("Clubs recurring billing migration contract", () => {
  test("creates every dedicated domain table with RLS", () => {
    const sql = migrationSql();
    const tables = [
      "clubs",
      "club_schedule_rules",
      "club_sessions",
      "club_participants",
      "club_memberships",
      "recurring_agreements",
      "recurring_charges",
      "club_attendance",
      "payment_webhook_events",
    ];

    for (const table of tables) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE public\\.${table}\\b`, "i"));
      expect(sql).toMatch(
        new RegExp(
          `ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`,
          "i",
        ),
      );
    }
  });

  test("enforces stable provider and webhook identities", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/UNIQUE\s*\(provider,\s*provider_recurring_id\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(provider,\s*provider_sale_id\)/i);
    expect(sql).toMatch(
      /UNIQUE\s*\(agreement_id,\s*provider_charge_number\)/i,
    );
    expect(sql).toMatch(/event_digest\s+TEXT\s+NOT NULL\s+UNIQUE/i);
    expect(sql).toMatch(/one_open_club_membership/i);
  });

  test("keeps billing writes server-side and reconciliation atomic", () => {
    const sql = migrationSql();

    for (const table of [
      "recurring_agreements",
      "recurring_charges",
      "payment_webhook_events",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `REVOKE\\s+(?:ALL|INSERT, UPDATE, DELETE).*public\\.${table}.*authenticated`,
          "is",
        ),
      );
    }

    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.process_icredit_recurring_event/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.cancel_icredit_recurring_membership/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.process_icredit_recurring_event.*FROM PUBLIC, anon, authenticated/is,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.process_icredit_recurring_event.*TO service_role/is,
    );
    expect(sql).toMatch(
      /SUM\(amount\).*status = 'failed'/is,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.cancel_icredit_recurring_membership[\s\S]*?UPDATE public\.club_memberships[\s\S]*?status = 'cancelled',[\s\S]*?payment_status = 'cancelled'/i,
    );
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.prepare_icredit_recurring_enrollment/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.save_club_with_schedule/i);
    expect(sql).toMatch(/processing_status[\s\S]*?v_agreement\.status = 'cancelled'[\s\S]*?THEN 'ignored'/i);
    expect(sql).toMatch(/compensation_required_at\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(/compensated_at\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(
      /v_inserted_event IS NULL[\s\S]*?compensation_required_at IS NOT NULL[\s\S]*?compensated_at IS NULL/i,
    );
    expect(sql).toMatch(
      /v_agreement\.status = 'cancelled'[\s\S]*?SET[\s\S]*?compensation_required_at = COALESCE/i,
    );
    expect(sql).toMatch(
      /p_event_kind = 'agreement_created'[\s\S]*?v_agreement\.status <> 'pending_enrollment'[\s\S]*?RETURN jsonb_build_object[\s\S]*?'ignored', true/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.complete_icredit_enrollment_compensation/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.cancel_icredit_recurring_membership[\s\S]*?pending_enrollment[\s\S]*?provider_recurring_id IS NULL[\s\S]*?provider cancellation confirmation required/i,
    );
    expect(sql).not.toMatch(/\benrollment_url\b/i);
  });
});
