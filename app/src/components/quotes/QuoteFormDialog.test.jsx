// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { catalog, catalogState, from, quoteInsert, quoteUpdate } = vi.hoisted(() => {
  const rows = { activities: [], products: [] };
  const state = { gate: null };
  const insert = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  return {
    catalog: rows,
    catalogState: state,
    quoteInsert: insert,
    quoteUpdate: update,
    from: vi.fn((table) => {
      if (table === "quotes") {
        return { insert, update };
      }
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(async (column, value) => {
          if (state.gate) await state.gate;
          return {
            data: rows[table].filter((row) => row[column] === value),
            error: null,
          };
        }),
      };
      return query;
    }),
  };
});

vi.mock("@/api/supabaseClient", () => ({
  supabase: { from },
}));

import QuoteFormDialog from "./QuoteFormDialog";

const activeActivity = {
  id: "activity-1",
  name: "פיצה קיימת",
  description: "פעילות קיימת",
  duration_hours: 1,
  price_per_person: 40,
  image_url: "",
  images: [],
  status: "פעיל",
};

const activeProduct = {
  id: "product-1",
  name: "אייס קפה חדש",
  description: "מוצר חדש",
  price: 15,
  image_url: "",
  site: "פודטראק",
  status: "פעיל",
};

const renderDialog = (open = true) => render(
  <QuoteFormDialog
    open={open}
    onClose={vi.fn()}
    onSaved={vi.fn()}
  />
);

beforeEach(() => {
  from.mockClear();
  quoteInsert.mockClear();
  quoteUpdate.mockClear();
  catalogState.gate = null;
  catalog.activities = [activeActivity];
  catalog.products = [
    activeProduct,
    { ...activeProduct, id: "product-disabled", name: "מוצר מושבת", status: "לא פעיל" },
  ];
});

afterEach(cleanup);

describe("QuoteFormDialog catalog", () => {
  test("offers active legacy activities and active Product Management products", async () => {
    renderDialog();

    expect(await screen.findByRole("button", { name: /פיצה קיימת/ })).toBeInTheDocument();
    const newProduct = await screen.findByRole("button", { name: /אייס קפה חדש/ });
    expect(newProduct).toBeInTheDocument();
    fireEvent.click(newProduct);
    expect(newProduct).toHaveClass("border-primary");
    expect(screen.queryByText("מוצר מושבת")).not.toBeInTheDocument();
    expect(from).toHaveBeenCalledWith("activities");
    expect(from).toHaveBeenCalledWith("products");
  });

  test("saves a selected product as a product snapshot without an activity foreign key", async () => {
    renderDialog();
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0], { target: { value: "לקוח בדיקה" } });
    fireEvent.change(textboxes[1], { target: { value: "0500000000" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
    fireEvent.click(await screen.findByRole("button", { name: /אייס קפה חדש/ }));
    fireEvent.click(screen.getByRole("button", { name: "צור הצעה" }));

    await waitFor(() => expect(quoteInsert).toHaveBeenCalledTimes(1));
    const payload = quoteInsert.mock.calls[0][0];
    expect(payload.selected_activities).toEqual([
      expect.objectContaining({
        item_type: "product",
        product_id: "product-1",
        activity_id: null,
        activity_name: "אייס קפה חדש",
        price_per_person: 15,
      }),
    ]);
  });

  test("does not reset typed form values when a delayed catalog request finishes", async () => {
    let releaseCatalog;
    catalogState.gate = new Promise((resolve) => { releaseCatalog = resolve; });
    renderDialog();
    const clientName = screen.getAllByRole("textbox")[0];
    fireEvent.change(clientName, { target: { value: "לא למחוק אותי" } });

    releaseCatalog();
    expect(await screen.findByRole("button", { name: /אייס קפה חדש/ })).toBeInTheDocument();
    expect(clientName).toHaveValue("לא למחוק אותי");
  });

  test("keeps an existing quotation snapshot unchanged when the catalog row has newer media", async () => {
    catalog.products = [{ ...activeProduct, image_url: "https://example.test/new.jpg" }];
    const savedSnapshot = {
      item_type: "product",
      product_id: "product-1",
      activity_id: null,
      activity_name: "אייס קפה חדש",
      price_per_person: 15,
      duration_hours: null,
      image_url: "",
      images: [],
      description: "מוצר חדש",
    };
    render(
      <QuoteFormDialog
        open
        quote={{
          id: "quote-1",
          client_name: "לקוח קיים",
          client_phone: "0500000000",
          num_participants: 2,
          selected_activities: [savedSnapshot],
          status: "טיוטה",
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(await screen.findByRole("button", { name: /אייס קפה חדש/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "עדכון" }));

    await waitFor(() => expect(quoteUpdate).toHaveBeenCalledTimes(1));
    expect(quoteUpdate.mock.calls[0][0].selected_activities).toEqual([savedSnapshot]);
  });

  test("reloads edited and deleted products whenever the dialog reopens", async () => {
    const view = renderDialog();
    expect(await screen.findByRole("button", { name: /אייס קפה חדש/ })).toBeInTheDocument();

    view.rerender(
      <QuoteFormDialog open={false} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    catalog.products = [{ ...activeProduct, name: "אייס קפה מעודכן", price: 18 }];
    view.rerender(
      <QuoteFormDialog open onClose={vi.fn()} onSaved={vi.fn()} />
    );

    expect(await screen.findByRole("button", { name: /אייס קפה מעודכן/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("אייס קפה חדש")).not.toBeInTheDocument());

    view.rerender(
      <QuoteFormDialog open={false} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    catalog.products = [];
    view.rerender(
      <QuoteFormDialog open onClose={vi.fn()} onSaved={vi.fn()} />
    );

    await waitFor(() => {
      expect(from.mock.calls.filter(([table]) => table === "products")).toHaveLength(3);
      expect(screen.queryByText("אייס קפה מעודכן")).not.toBeInTheDocument();
    });
  });
});
