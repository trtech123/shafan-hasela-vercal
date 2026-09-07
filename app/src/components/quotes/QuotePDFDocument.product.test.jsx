// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import QuotePDFDocument from "./QuotePDFDocument";

afterEach(cleanup);

describe("QuotePDFDocument product rows", () => {
  test("does not print an activity duration for products that have none", () => {
    render(
      <QuotePDFDocument
        mode="quote"
        onClose={vi.fn()}
        quote={{
          quote_number: "QUO-TEST",
          client_name: "לקוח בדיקה",
          client_phone: "0500000000",
          num_participants: 2,
          total_price: 30,
          final_price: 30,
          selected_activities: [{
            item_type: "product",
            product_id: "product-1",
            activity_id: null,
            activity_name: "אייס קפה חדש",
            price_per_person: 15,
            duration_hours: null,
          }],
        }}
      />
    );

    expect(screen.getByText("אייס קפה חדש")).toBeInTheDocument();
    expect(screen.queryByText(/שעות/)).not.toBeInTheDocument();
  });
});
