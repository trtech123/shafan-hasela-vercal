// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";

const { from, orderInsert, toastError } = vi.hoisted(() => {
  const insert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({ data: { id: "order-1", order_number: "ORD-1" }, error: null })),
    })),
  }));
  return {
    orderInsert: insert,
    toastError: vi.fn(),
    from: vi.fn((table) => {
      if (table === "quotes") {
        return {
          select: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(async () => ({
                data: [{
                id: "quote-1",
                quote_number: "QUO-1",
                client_name: "לקוח מוצר",
                client_phone: "0500000000",
                num_participants: 2,
                final_price: 30,
                status: "טיוטה",
                selected_activities: [{
                  item_type: "product",
                  product_id: "product-1",
                  activity_id: null,
                  activity_name: "אייס קפה חדש",
                  price_per_person: 15,
                }],
                }],
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "activities") {
        return { select: vi.fn(async () => ({ data: [], error: null })) };
      }
      if (table === "orders") {
        return { insert };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
});

vi.mock("@/api/supabaseClient", () => ({ supabase: { from } }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/components/quotes/QuoteFormDialog", () => ({ default: () => null }));
vi.mock("@/components/quotes/QuotePDFDocument", () => ({ default: () => null }));

import Quotes from "./Quotes";

afterEach(cleanup);

describe("Quotes product conversion", () => {
  test("blocks legacy order conversion instead of silently dropping selected products", async () => {
    render(<Quotes />);
    expect(await screen.findByText("לקוח מוצר")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "הפוך להזמנה" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(orderInsert).not.toHaveBeenCalled();
  });
});
