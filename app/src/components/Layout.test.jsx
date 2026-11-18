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

test.each([
  ['admin', '/club-attendance', 'נוכחות חוגים'],
  ['מדריך', '/instructor-attendance', 'נוכחות בחוגים'],
  ['admin', '/pelecard-transactions', 'עסקאות פלאקארד'],
])('%s can open %s', (role, path, label) => {
  currentRole = role;
  render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<Layout />}>
    <Route path={path} element={<h1>מסך בדיקה</h1>} />
  </Route></Routes></MemoryRouter>);
  expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', path);
  expect(screen.getByRole('heading', { name: 'מסך בדיקה' })).toBeInTheDocument();
});

test.each(['admin', 'אחמ"ש', 'קופאי'])('%s can navigate to customer management', (role) => {
  currentRole = role;
  render(<MemoryRouter initialEntries={['/customers']}><Routes><Route element={<Layout />}>
    <Route path="/customers" element={<h1>מסך לקוחות</h1>} />
    <Route path="/schedule" element={<h1>לוח זמנים</h1>} />
  </Route></Routes></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'לקוחות' })).toHaveAttribute('href', '/customers');
  expect(screen.getByRole('heading', { name: 'מסך לקוחות' })).toBeInTheDocument();
});

test('an instructor cannot open customer management', () => {
  currentRole = 'מדריך';
  render(<MemoryRouter initialEntries={['/customers']}><Routes><Route element={<Layout />}>
    <Route path="/customers" element={<h1>מסך לקוחות</h1>} />
    <Route path="/schedule" element={<h1>לוח זמנים</h1>} />
  </Route></Routes></MemoryRouter>);
  expect(screen.queryByRole('link', { name: 'לקוחות' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'לוח זמנים' })).toBeInTheDocument();
});

test('an authenticated instructor can open the cashier for physical collection', () => {
  currentRole = 'מדריך';
  render(<MemoryRouter initialEntries={['/cashregister']}><Routes><Route element={<Layout />}>
    <Route path="/cashregister" element={<h1>קופה פיזית</h1>} />
    <Route path="/schedule" element={<h1>לוח זמנים</h1>} />
  </Route></Routes></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'קופה' })).toHaveAttribute('href', '/cashregister');
  expect(screen.getByRole('heading', { name: 'קופה פיזית' })).toBeInTheDocument();
});

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
  test("operational alerts sit in page flow instead of covering navigation", () => {
    const { container } = renderAtAccounting('admin');
    const alertSlot = container.querySelector('main .mb-4.space-y-2');
    expect(alertSlot).toBeInTheDocument();
    expect(alertSlot).not.toHaveClass('fixed');
    expect(container.querySelector('.fixed.left-3.top-3')).toBeNull();
  });

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
