import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appSource = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

describe("public policy routes", () => {
  test.each([
    ["/privacy-policy", "PrivacyPolicy"],
    ["/data-deletion", "DataDeletion"],
  ])("registers %s before the authenticated wildcard", (path, component) => {
    const publicRoute = `path="${path}" element={<${component} />}`;
    const routePosition = appSource.indexOf(publicRoute);
    const authenticatedPosition = appSource.indexOf('path="/*" element={<AuthenticatedApp />}');

    expect(routePosition).toBeGreaterThan(-1);
    expect(authenticatedPosition).toBeGreaterThan(routePosition);
  });
});
