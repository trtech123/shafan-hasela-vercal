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
vi.mock("@/components/accounting/PayperAdminAlert", () => ({ default: () => null }));
vi.mock("@/components/accounting/PelecardPendingReview", () => ({ PelecardPendingAlert: () => null }));

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

describe("Cafeteria product navigation", () => {
  test.each(["admin", "קופאי"])("%s can reach cafeteria products", (role) => {
    currentRole = role;
    render(<MemoryRouter initialEntries={["/cafeteria-products"]}><Routes><Route element={<Layout />}><Route path="/cafeteria-products" element={<h1>קפיטריה</h1>} /></Route></Routes></MemoryRouter>);
    expect(screen.getByRole("link", { name: "ניהול מוצרי קפיטריה" })).toHaveAttribute("href", "/cafeteria-products");
    expect(screen.getByRole("heading", { name: "קפיטריה" })).toBeInTheDocument();
  });
  test.each(['אחמ"ש', "מדריך"])("%s cannot reach cafeteria products", (role) => {
    currentRole = role;
    render(<MemoryRouter initialEntries={["/cafeteria-products"]}><Routes><Route element={<Layout />}><Route path="/cafeteria-products" element={<h1>קפיטריה</h1>} /><Route path="/schedule" element={<h1>לוח זמנים</h1>} /></Route></Routes></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "ניהול מוצרי קפיטריה" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "לוח זמנים" })).toBeInTheDocument();
  });
});

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
