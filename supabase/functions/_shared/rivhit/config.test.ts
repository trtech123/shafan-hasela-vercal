import { describe, expect, test } from "vitest";
import { getDocumentMapping, parseDocumentTypeMap } from "./config.ts";

const validMapping = {
  document_type: 1,
  sort_code: 100,
  currency_id: 1,
  price_include_vat: true,
  send_mail: false,
  digital_signature: false,
};

describe("Rivhit document configuration", () => {
  test("parses a complete server-side mapping", () => {
    const parsed = parseDocumentTypeMap(JSON.stringify({ sandbox_test: validMapping }));
    expect(getDocumentMapping(parsed, "sandbox_test")).toEqual(validMapping);
  });

  test("rejects missing configuration", () => {
    expect(() => parseDocumentTypeMap(undefined)).toThrow(
      "RIVHIT_DOCUMENT_TYPE_MAP is not configured",
    );
  });

  test("rejects malformed JSON without echoing it", () => {
    const secretLikeValue = '{"token":"do-not-echo"';
    expect(() => parseDocumentTypeMap(secretLikeValue)).toThrow(
      "RIVHIT_DOCUMENT_TYPE_MAP is invalid JSON",
    );
    try {
      parseDocumentTypeMap(secretLikeValue);
    } catch (error) {
      expect(String(error)).not.toContain("do-not-echo");
    }
  });

  test.each([
    ["document_type", { ...validMapping, document_type: 0 }],
    ["sort_code", { ...validMapping, sort_code: 1000 }],
    ["currency_id", { ...validMapping, currency_id: 11 }],
    ["price_include_vat", { ...validMapping, price_include_vat: "yes" }],
    ["send_mail", { ...validMapping, send_mail: 1 }],
    ["digital_signature", { ...validMapping, digital_signature: null }],
  ])("rejects an invalid %s", (field, mapping) => {
    expect(() => parseDocumentTypeMap(JSON.stringify({ test: mapping }))).toThrow(
      `Invalid Rivhit mapping "test": ${field}`,
    );
  });

  test("rejects an unknown mapping key", () => {
    const parsed = parseDocumentTypeMap(JSON.stringify({ sandbox_test: validMapping }));
    expect(() => getDocumentMapping(parsed, "paid_order")).toThrow(
      'Rivhit document mapping "paid_order" is not configured',
    );
  });
});
