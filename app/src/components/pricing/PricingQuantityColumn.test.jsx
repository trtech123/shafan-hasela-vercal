// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import PricingCategory from "./PricingCategory";

const baseRow = {
  id: "row-1",
  description: "בדיקה",
  quantity: 7,
  cost: "",
  sell_price: "",
  total_cost: 0,
  total_sell: 0,
  profit: 0,
  margin_pct: 0,
  notes: "",
};

const renderCategory = (quantity) =>
  render(
    <PricingCategory
      category={{ id: "category-1", name: "קטגוריה", rows: [{ ...baseRow, quantity }] }}
      onChange={vi.fn()}
      onDelete={vi.fn()}
      numParticipants={1}
    />
  );

afterEach(cleanup);

describe("Pricing Quantity column layout", () => {
  test("keeps single- and multi-digit values in a non-compressible aligned column", () => {
    const { container, rerender } = renderCategory(7);

    const quantityHeader = screen.getByRole("columnheader", { name: "כמות" });
    const quantityInput = container.querySelector('input[type="number"][min="0"]');
    const quantityCell = quantityInput.closest("td");

    expect(quantityHeader).toHaveClass("w-40", "min-w-[10rem]");
    expect(quantityCell).toHaveClass("w-40", "min-w-[10rem]", "px-2");
    expect(quantityInput).toHaveClass("w-full", "min-w-[9rem]", "px-2", "tabular-nums");
    expect(quantityInput).toHaveAttribute("dir", "ltr");
    expect(quantityInput).toHaveAttribute("type", "number");
    expect(quantityInput).toHaveAttribute("min", "0");
    expect(quantityInput).toHaveValue(7);
    expect(container.querySelector(".overflow-x-auto")).toBeInTheDocument();

    rerender(
      <PricingCategory
        category={{ id: "category-1", name: "קטגוריה", rows: [{ ...baseRow, quantity: 12345 }] }}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        numParticipants={1}
      />
    );

    expect(container.querySelector('input[type="number"][min="0"]')).toHaveValue(12345);
  });
});
