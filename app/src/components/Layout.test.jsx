// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Layout from "./Layout";

let currentRole = "admin";

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    user: { full_name: "בודק", role: currentRole },
    logout: vi.fn(),
  }),
}));

vi.mock("@/components/SiteOpeningPrompt", () => ({
  default: () => null,
}));

const renderAtClubs = (role) => {
  currentRole = role;
  return render(
    <MemoryRouter initialEntries={["/clubs"]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/clubs" element={<h1>מסך חוגים</h1>} />
          <Route path="/schedule" element={<h1>לוח זמנים</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
};

const renderAtAccounting = (role) => {
  currentRole = role;
  return render(
    <MemoryRouter initialEntries={["/accounting-operations"]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/accounting-operations" element={<h1>מסך בקרת הנה״ח</h1>} />
          <Route path="/schedule" element={<h1>לוח זמנים</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
};

afterEach(() => cleanup());

describe("Clubs navigation and route authorization", () => {
  test("an admin sees the חוגים navigation entry and direct route content", () => {
    renderAtClubs("admin");

    expect(screen.getByRole("link", { name: "חוגים" })).toHaveAttribute("href", "/clubs");
    expect(screen.getByRole("heading", { name: "מסך חוגים" })).toBeInTheDocument();
  });

  test("a non-admin neither sees Clubs navigation nor reaches its route", () => {
    renderAtClubs("מדריך");

    expect(screen.queryByRole("link", { name: "חוגים" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "מסך חוגים" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "לוח זמנים" })).toBeInTheDocument();
  });
});

describe("Accounting operations navigation and route authorization", () => {
  test.each(["admin", 'אחמ"ש'])("%s sees and can open accounting operations", (role) => {
    renderAtAccounting(role);

    expect(screen.getByRole("link", { name: "בקרת הנה״ח" }))
      .toHaveAttribute("href", "/accounting-operations");
    expect(screen.getByRole("heading", { name: "מסך בקרת הנה״ח" })).toBeInTheDocument();
  });

  test.each(["קופאי", "מדריך"])("%s cannot see or open accounting operations", (role) => {
    renderAtAccounting(role);

    expect(screen.queryByRole("link", { name: "בקרת הנה״ח" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "מסך בקרת הנה״ח" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "לוח זמנים" })).toBeInTheDocument();
  });
});
