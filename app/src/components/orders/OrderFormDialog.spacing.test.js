import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const source = readFileSync(new URL("./OrderFormDialog.jsx", import.meta.url), "utf8");

describe("OrderFormDialog pricing spacing", () => {
  test("adds vertical separation only to the standard pricing row", () => {
    expect(source).toContain(
      '<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-2">'
    );
    expect(source).toContain(
      '<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">'
    );
  });
});
