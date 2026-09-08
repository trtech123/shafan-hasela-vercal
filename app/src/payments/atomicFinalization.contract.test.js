import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../../../supabase/migrations/023_pelecard_payment_workflow.sql",
  import.meta.url,
));
const pgTapPath = fileURLToPath(new URL(
  "../../../supabase/tests/pelecard_payment_workflow.sql",
  import.meta.url,
));

const read = (path) => existsSync(path) ? readFileSync(path, "utf8") : "";
const normalize = (sql) =>
  sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();

describe("Pelecard atomic workflow migration", () => {
  test("ships the additive migration and disposable pgTAP suite", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(pgTapPath)).toBe(true);
    expect(normalize(read(pgTapPath))).toContain("rollback");
  });

  test("persists only a constrained hosted redirect and protects it after assignment", () => {
    const sql = normalize(read(migrationPath));
    expect(sql).toContain("add column if not exists provider_redirect_url text");
    expect(sql).toContain("payment_transactions_provider_redirect_url_safe");
    expect(sql).toContain("https://");
    expect(sql).toContain("old.provider_redirect_url is not null");
    expect(sql).toContain("provider redirect url is immutable once assigned");
  });

  test.each([
    "reserve_pelecard_payment",
    "complete_pelecard_initiation",
    "mark_pelecard_initiation_uncertain",
    "get_pelecard_payment",
    "fail_pelecard_payment",
    "record_pelecard_verification_rejection",
    "finalize_pelecard_payment",
  ])("creates service-only RPC %s", (name) => {
    const sql = normalize(read(migrationPath));
    expect(sql).toContain(`create or replace function public.${name}(`);
    expect(sql).toContain(
      `revoke all on function public.${name}`,
    );
    expect(sql).toMatch(
      new RegExp(`grant execute on function public\\.${name}[^;]+to service_role`),
    );
  });

  test("uses conflict-safe reservation and row locks without external work", () => {
    const sql = normalize(read(migrationPath));
    expect(sql).toContain("on conflict (provider, idempotency_key) do nothing");
    expect(sql.match(/for update/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).not.toMatch(
      /http_(?:get|post)|net\.http|pg_net|gateway\d*\.pelecard/,
    );
  });

  test("atomically creates one verified sale and updates the linked order and ledger", () => {
    const sql = read(migrationPath);
    const normalized = normalize(sql);
    expect(normalized).toContain("insert into public.sales");
    expect(normalized).toContain("payment_transaction_id");
    expect(normalized).toContain("update public.orders");
    expect(normalized).toContain("update public.payment_transactions");
    expect(sql).toContain("'פלאקארד'");
    expect(sql).toContain("'אשראי'");
    expect(normalized).toContain("if payment_row.status = 'succeeded'");
  });

  test("never exposes the hosted URL through authenticated table selection", () => {
    const sql = normalize(read(migrationPath));
    expect(sql).toContain(
      "revoke select on public.payment_transactions from authenticated",
    );
    expect(sql).toContain("grant select (");
    expect(sql).not.toMatch(/grant select \([^)]*provider_redirect_url/);
    expect(sql).not.toMatch(/grant select \([^)]*provider_session_id/);
  });

  test("authors exactly-once, retry, mismatch, and privilege behavior checks", () => {
    const sql = normalize(read(pgTapPath));
    for (const phrase of [
      "one sale is created",
      "duplicate finalization returns the same sale",
      "finalization retry after committed response loss is idempotent",
      "provider transaction cannot be assigned twice",
      "amount mismatch cannot finalize",
      "currency mismatch cannot finalize",
      "authenticated cannot execute finalization",
      "manual credit sale remains unchanged",
      "rejected verification is audited without changing payment status",
    ]) {
      expect(sql).toContain(phrase);
    }
  });
});
