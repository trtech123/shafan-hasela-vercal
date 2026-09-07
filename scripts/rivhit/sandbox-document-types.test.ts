import { describe, expect, test } from "vitest";
import { documentTypesFromEnvelope } from "./sandbox-document-types.ts";

describe("documentTypesFromEnvelope", () => {
  test("reads Rivhit's document_type_list response", () => {
    expect(documentTypesFromEnvelope({
      data: {
        document_type_list: [{ document_type: 1, is_accounting: true }],
      },
    })).toEqual([{ document_type: 1, is_accounting: true }]);
  });
});
