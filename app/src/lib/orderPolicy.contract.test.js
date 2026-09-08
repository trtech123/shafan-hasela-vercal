import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ordersPagePath = fileURLToPath(new URL("../pages/Orders.jsx", import.meta.url));
const orderComponentsPath = fileURLToPath(new URL("../components/orders/", import.meta.url));
const legacyDialogPath = fileURLToPath(
  new URL("../components/orders/OrderDocumentDialog.jsx", import.meta.url),
);
const canonicalPolicyPath = fileURLToPath(new URL("./orderDocText.js", import.meta.url));

const orderComponentSources = () => readdirSync(orderComponentsPath)
  .filter((name) => /\.jsx?$/.test(name))
  .map((name) => readFileSync(`${orderComponentsPath}/${name}`, "utf8"))
  .join("\n");

describe("customer order policy ownership", () => {
  test("keeps the client-approved 72-hour policy in the canonical source", () => {
    const policy = readFileSync(canonicalPolicyPath, "utf8");

    expect(policy).toContain("72 שעות");
    expect(policy).toContain("תנאי מזג האוויר אינם עילה לביטול");
  });

  test("does not retain the obsolete legacy dialog or its wiring", () => {
    const ordersPage = readFileSync(ordersPagePath, "utf8");

    expect(existsSync(legacyDialogPath)).toBe(false);
    expect(ordersPage).not.toMatch(/OrderDocumentDialog|docOrder|setDocOrder/);
  });

  test("does not embed obsolete cancellation or weather terms in order components", () => {
    const components = orderComponentSources();

    expect(components).not.toMatch(/ביטול עד 7 ימים|ביטול 3[–-]7 ימים/);
    expect(components).not.toContain("לשנות או לבטל פעילות בתנאי מזג אוויר");
  });
});
