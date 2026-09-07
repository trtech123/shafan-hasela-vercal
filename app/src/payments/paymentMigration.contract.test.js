import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../../supabase/migrations/021_pelecard_payment_ledger.sql", import.meta.url),
);

const readMigration = () =>
  existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

const normalize = (sql) =>
  sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();

describe("Pelecard payment ledger migration", () => {
  test("migration exists", () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  test("creates the transaction and append-only event ledgers", () => {
    const normalized = normalize(readMigration());

    expect(normalized).toContain("create table public.payment_transactions");
    expect(normalized).toContain("create table public.payment_transaction_events");
    expect(normalized).toContain(
      "alter table public.payment_transactions enable row level security",
    );
    expect(normalized).toContain(
      "alter table public.payment_transaction_events enable row level security",
    );
  });

  test("enforces provider and idempotency uniqueness", () => {
    const normalized = normalize(readMigration());

    expect(normalized).toMatch(
      /unique index[^;]+provider[^;]+provider_transaction_id/,
    );
    expect(normalized).toMatch(/unique[^;]+provider[^;]+idempotency_key/);
    expect(normalized).toMatch(
      /unique index[^;]+sale_id[^;]+where sale_id is not null/,
    );
  });

  test("does not define card-data columns", () => {
    const normalized = normalize(readMigration());

    for (const forbidden of [
      "pan",
      "cvv",
      "card_number",
      "card_expiry",
      "expiry_date",
      "card_token",
      "raw_provider_response",
      "provider_payload",
    ]) {
      expect(normalized).not.toMatch(
        new RegExp(`\\b${forbidden}\\s+(text|varchar|jsonb)`),
      );
    }

    expect(normalized).toContain(
      "public.payment_json_is_safe(checkout_snapshot)",
    );
    expect(normalized).toContain("public.payment_json_is_safe(metadata)");
  });

  test("keeps external credit distinct from verified Pelecard", () => {
    const sql = readMigration();
    const normalized = normalize(sql);

    expect(sql).toContain("'אשראי'");
    expect(sql).toContain("'פלאקארד'");
    expect(normalized).toContain("payment_transaction_id");
  });

  test("blocks authenticated ledger mutation and makes events append-only", () => {
    const normalized = normalize(readMigration());

    expect(normalized).toContain(
      "revoke insert, update, delete on public.payment_transactions from anon, authenticated",
    );
    expect(normalized).toContain(
      "revoke insert, update, delete on public.payment_transaction_events from anon, authenticated",
    );
    expect(normalized).toContain(
      "before update or delete on public.payment_transaction_events",
    );
    expect(normalized).toContain("before delete on public.payment_transactions");
  });
});
