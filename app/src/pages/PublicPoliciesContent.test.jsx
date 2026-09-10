// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PrivacyPolicy from "./PrivacyPolicy";
import DataDeletion from "./DataDeletion";

afterEach(cleanup);

function renderPage(Page) {
  return render(
    <MemoryRouter>
      <Page />
    </MemoryRouter>,
  );
}

describe("PrivacyPolicy", () => {
  test("publishes the required customer-facing privacy disclosures", () => {
    renderPage(PrivacyPolicy);

    expect(screen.getByRole("heading", { name: "מדיניות פרטיות" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "שפן הסלע" })).toHaveAttribute("src", "/shafan-logo.jpg");
    expect(screen.getByText(/פרטי קשר/)).toBeInTheDocument();
    expect(screen.getByText(/תוכן השיחה וההודעות/)).toBeInTheDocument();
    expect(screen.getByText(/פרטי הזמנה/)).toBeInTheDocument();
    expect(screen.getByText(/Meta ו-WhatsApp/)).toBeInTheDocument();
    expect(screen.getByText(/פרטי כרטיס.*אינם נאספים באמצעות הצ׳אטבוט/)).toBeInTheDocument();
    expect(screen.getByText(/הגישה למידע מוגבלת/)).toBeInTheDocument();
    expect(screen.getByText(/תיקון או מחיקה/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Info.shafan@gmail.com" }))
      .toHaveAttribute("href", "mailto:Info.shafan@gmail.com");
    expect(screen.queryByRole("heading", { name: "כניסה למערכת" })).not.toBeInTheDocument();
  });
});

describe("DataDeletion", () => {
  test("explains a review-based deletion request using minimum identifying information", () => {
    renderPage(DataDeletion);

    expect(screen.getByRole("heading", { name: "בקשה למחיקת מידע" })).toBeInTheDocument();
    expect(screen.getByText("שם מלא")).toBeInTheDocument();
    expect(screen.getByText("מספר הטלפון שבו התנהלה השיחה ב-WhatsApp")).toBeInTheDocument();
    expect(screen.getByText(/הקשר קצר לשיחה או להזמנה/)).toBeInTheDocument();
    expect(screen.getByText(/ייתכן שנבקש לאמת/)).toBeInTheDocument();
    expect(screen.getByText(/אינה מתבצעת באופן אוטומטי או מיידי/)).toBeInTheDocument();
    expect(screen.getByText(/תפעוליים, חשבונאיים או משפטיים/)).toBeInTheDocument();
    expect(screen.getByText(/אין לשלוח.*פרטי כרטיס/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Info.shafan@gmail.com" }))
      .toHaveAttribute("href", "mailto:Info.shafan@gmail.com");
    expect(screen.queryByRole("heading", { name: "כניסה למערכת" })).not.toBeInTheDocument();
  });
});
