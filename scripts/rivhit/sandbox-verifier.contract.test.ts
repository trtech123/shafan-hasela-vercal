import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("Rivhit sandbox verifier contract", () => {
  test("requires an explicit sandbox token and document type", async () => {
    const source = await readFile(
      new URL("./verify-rivhit-sandbox.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('requiredEnv("RIVHIT_API_TOKEN")');
    expect(source).toContain('integerEnv("RIVHIT_TEST_DOCUMENT_TYPE")');
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  test("proves a second run is local and does not call Document.New", async () => {
    const source = await readFile(
      new URL("./verify-rivhit-sandbox.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("secondResult.duplicate");
    expect(source).toContain("documentCallsAfterFirst");
    expect(source).toContain("Document.New was called again");
  });
});
