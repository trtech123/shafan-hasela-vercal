import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../../../supabase/migrations/027_payment_accounting_orchestration.sql",
  import.meta.url,
));
const pgTapPath = fileURLToPath(new URL(
  "../../../supabase/tests/payment_accounting_orchestration.sql",
  import.meta.url,
));

const read = (path) => existsSync(path) ? readFileSync(path, "utf8") : "";
const normalize = (sql) =>
  sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();

describe("payment accounting orchestration migration", () => {
  test("ships migration 027 and a disposable behavior suite", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(pgTapPath)).toBe(true);
    expect(normalize(read(pgTapPath))).toContain("rollback");
  });

  test("creates a provider-neutral event with one source-purpose-provider identity", () => {
    const sql = normalize(read(migrationPath));
    expect(sql).toContain("create table public.accounting_events");
    expect(sql).toMatch(
      /unique\s*\(source_type,\s*source_id,\s*purpose,\s*accounting_provider\)/,
    );
    for (const status of [
      "pending",
      "processing",
      "succeeded",
      "retryable_error",
      "permanent_error",
      "reconciliation_required",
      "configuration_required",
    ]) {
      expect(sql).toContain(`'${status}'`);
    }
  });

  test("emits only from a durable verified Pelecard success transition", () => {
    const sql = normalize(read(migrationPath));
    expect(sql).toContain(
      "after insert or update of status on public.payment_transactions",
    );
    expect(sql).toContain("new.provider = 'pelecard'");
    expect(sql).toContain("new.operation = 'payment'");
    expect(sql).toContain("new.status = 'succeeded'");
    expect(sql).toContain("old.status is distinct from 'succeeded'");
    expect(sql).toContain("new.verified_at is not null");
    expect(sql).toContain("new.provider_transaction_id is not null");
    expect(sql).toContain("new.sale_id is not null");
    expect(sql).toContain("'payment_transaction'");
    expect(sql).toContain("'payment_success'");
    expect(sql).toContain("'rivhit'");
    expect(sql).toContain("on conflict (source_type, source_id, purpose, accounting_provider) do nothing");
  });

  test("claims work with leases, skip-locked concurrency, and explicit retry rules", () => {
    const sql = normalize(read(migrationPath));
    expect(sql).toContain("create or replace function public.claim_accounting_event(");
    expect(sql).toContain("p_lease_seconds integer default 300");
    expect(sql).toContain("p_force_retry boolean default false");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("lease_token");
    expect(sql).toContain("lease_expires_at");
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("status = 'retryable_error'");
    expect(sql).toContain("status = 'configuration_required' and p_force_retry");
  });

  test("fences completion and allowlisted failures by attempt and lease", () => {
    const sql = normalize(read(migrationPath));
    for (const name of ["complete_accounting_event", "fail_accounting_event"]) {
      expect(sql).toContain(`create or replace function public.${name}(`);
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${name}[^;]+to service_role`),
      );
    }
    expect(sql.match(/attempt_count = p_attempt_count/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql.match(/lease_token = p_lease_token/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql.match(/status = 'processing'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain(
      "p_status not in ('retryable_error', 'permanent_error', 'reconciliation_required', 'configuration_required')",
    );
  });

  test("provides admin/operations read-only visibility and a server-derived retry flag", () => {
    const sql = normalize(read(migrationPath));
    expect(sql).toContain("alter table public.accounting_events enable row level security");
    expect(sql).toContain("public.is_admin_or_ops()");
    expect(sql).toContain("create view public.payment_accounting_operations");
    expect(sql).toContain("security_invoker = true");
    expect(sql).toContain("retry_allowed");
    expect(sql).toContain("reconciliation_required");
    expect(sql).toContain("left join public.payment_transactions");
    expect(sql).toContain("left join lateral");
    expect(sql).toContain("public.accounting_documents");
    expect(sql).toContain("when ae.status = 'configuration_required' then true");
    expect(sql).toContain("grant select on public.payment_accounting_operations to authenticated");
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)[^;]+authenticated/);
  });

  test("keeps mutation service-only and never mutates payment state or starts iCredit accounting", () => {
    const sql = normalize(read(migrationPath));
    for (const name of [
      "claim_accounting_event",
      "complete_accounting_event",
      "fail_accounting_event",
    ]) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${name}[^;]+from public, anon, authenticated, service_role`),
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${name}[^;]+to service_role`),
      );
    }
    expect(sql).not.toContain("update public.payment_transactions");
    expect(sql).not.toMatch(/insert into public\.accounting_events[\s\S]+icredit/);
    expect(sql).not.toMatch(/insert into public\.accounting_events\s*\([^;]+\)\s*select/);
  });

  test("authors exactly-once, lease, fencing, and payment-preservation behavior checks", () => {
    const sql = normalize(read(pgTapPath));
    for (const phrase of [
      "verified success creates one accounting event",
      "duplicate finalization does not duplicate the accounting event",
      "second claim cannot steal a live lease",
      "expired lease can be reclaimed",
      "stale attempt cannot complete newer work",
      "wrong lease token cannot fail work",
      "event failure does not reverse payment success",
      "configuration-required event is reported retryable",
      "configuration-required event requires an explicit force retry",
    ]) {
      expect(sql).toContain(phrase);
    }
  });
});
