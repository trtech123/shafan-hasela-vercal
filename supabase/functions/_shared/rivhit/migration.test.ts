import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const migrationUrl = new URL("../../../migrations/021_rivhit_accounting.sql", import.meta.url);

describe("021 Rivhit accounting migration", () => {
  const sql = readFileSync(migrationUrl, "utf8");

  test("creates generic accounting tables without changing orders or sales", () => {
    expect(sql).toContain("CREATE TABLE public.accounting_customers");
    expect(sql).toContain("CREATE TABLE public.accounting_documents");
    expect(sql).not.toMatch(/ALTER TABLE public\.(orders|sales)\s+(ADD|DROP|ALTER)/i);
  });

  test("enforces customer and document idempotency", () => {
    expect(sql).toContain("account_namespace");
    expect(sql).toContain("UNIQUE (provider, account_namespace, identity_key)");
    expect(sql).toContain("UNIQUE (provider, account_namespace, external_reference)");
    expect(sql).toContain(
      "UNIQUE (provider, account_namespace, source_type, source_id, document_type_key)",
    );
    expect(sql).toContain("UNIQUE (provider, account_namespace, request_reference)");
    expect(sql).toContain("payload_hash");
  });

  test("indexes the foreign key and enables read-only RLS", () => {
    expect(sql).toContain(
      "CREATE INDEX idx_accounting_documents_customer_id",
    );
    expect(sql).toContain(
      "ALTER TABLE public.accounting_customers ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "ALTER TABLE public.accounting_documents ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).toContain('CREATE POLICY "accounting customers: admin/ops read"');
    expect(sql).toContain('CREATE POLICY "accounting documents: admin/ops read"');
    expect(sql).not.toMatch(/accounting (customers|documents):.*(insert|update|delete)/i);
  });

  test("restricts atomic claim functions to the service role", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.claim_accounting_customer",
    );
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.claim_accounting_document",
    );
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = ''/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM anon/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO service_role/i);
  });

  test("returns retry timing from both atomic claim functions", () => {
    const customerClaim = sql.match(
      /CREATE OR REPLACE FUNCTION public\.claim_accounting_customer[\s\S]+?\n\$\$;/i,
    )?.[0];
    const documentClaim = sql.match(
      /CREATE OR REPLACE FUNCTION public\.claim_accounting_document[\s\S]+?\n\$\$;/i,
    )?.[0];
    expect(customerClaim).toContain("retry_after TIMESTAMPTZ");
    expect(documentClaim).toContain("retry_after TIMESTAMPTZ");
  });

  test("fences finalization by attempt generation", () => {
    expect(sql).toContain("complete_accounting_customer");
    expect(sql).toContain("fail_accounting_customer");
    expect(sql).toContain("complete_accounting_document");
    expect(sql).toContain("fail_accounting_document");
    expect(sql).toMatch(/attempt_count = p_attempt_count[\s\S]+status = 'processing'/i);
  });

  test("prevents non-admin users from changing profile roles", () => {
    expect(sql).toContain("protect_profile_role_updates");
    expect(sql).toContain("BEFORE UPDATE OF role ON public.profiles");
    expect(sql).toMatch(/role = 'admin'/i);
  });
});
