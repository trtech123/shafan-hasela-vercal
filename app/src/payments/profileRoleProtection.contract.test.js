import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../../../supabase/migrations/022_protect_profile_role.sql",
  import.meta.url,
));
const behaviorTestPath = fileURLToPath(new URL(
  "../../../supabase/tests/profile_role_protection.sql",
  import.meta.url,
));

const normalize = (sql) =>
  sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();

describe("profile role protection migration", () => {
  test("ships an additive role-guard migration", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = normalize(readFileSync(migrationPath, "utf8"));

    expect(sql).toContain(
      "create or replace function public.protect_profile_role_change()",
    );
    expect(sql).toContain("returns trigger");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("new.role is not distinct from old.role");
    expect(sql).toContain("coalesce(auth.role(), '') = 'service_role'");
    expect(sql).toContain("public.is_admin()");
    expect(sql).toContain("using errcode = '42501'");
    expect(sql).toContain(
      "before update of role on public.profiles",
    );
  });

  test("does not weaken or replace existing profile RLS policies", () => {
    const sql = normalize(readFileSync(migrationPath, "utf8"));

    expect(sql).not.toContain("drop policy");
    expect(sql).not.toContain("disable row level security");
    expect(sql).toContain(
      "revoke all on function public.protect_profile_role_change() from public, anon, authenticated, service_role",
    );
  });

  test("ships disposable pgTAP coverage for caller role behavior", () => {
    expect(existsSync(behaviorTestPath)).toBe(true);
    const sql = normalize(readFileSync(behaviorTestPath, "utf8"));

    expect(sql).toContain("select extensions.plan(4)");
    expect(sql).toContain("instructor cannot promote their own role");
    expect(sql).toContain("instructor can update ordinary profile fields");
    expect(sql).toContain("admin can assign a profile role");
    expect(sql).toContain("service role can assign a profile role");
    expect(sql).toContain("set local role authenticated");
    expect(sql).toContain("set local role service_role");
    expect(sql).toContain("rollback");
  });
});
