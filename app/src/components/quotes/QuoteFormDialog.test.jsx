// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { catalog, catalogState, from, quoteInsert, quoteUpdate, saveQuotation } = vi.hoisted(() => {
  const rows = { activities: [], products: [] };
  const state = { gate: null };
  const insert = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  return {
    catalog: rows,
    catalogState: state,
    quoteInsert: insert,
    quoteUpdate: update,
    saveQuotation: vi.fn(async () => ({ data: { id: "saved-quote" }, error: null })),
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
  supabase: { from, rpc: saveQuotation },
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
  saveQuotation.mockClear();
  saveQuotation.mockResolvedValue({ data: { id: "saved-quote" }, error: null });
  catalogState.gate = null;
  catalog.activities = [activeActivity];
  catalog.products = [
    activeProduct,
    { ...activeProduct, id: "product-disabled", name: "מוצר מושבת", status: "לא פעיל" },
  ];
});

afterEach(cleanup);

describe("QuoteFormDialog catalog", () => {
  test("creates a quotation through the revision-safe production RPC", async () => {
    const onSaved = vi.fn();
    render(<QuoteFormDialog open onClose={vi.fn()} onSaved={onSaved} />);
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0], { target: { value: "לקוח בדיקה" } });
    fireEvent.change(textboxes[1], { target: { value: "0500000000" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
    fireEvent.click(await screen.findByRole("button", { name: /פיצה קיימת/ }));
    fireEvent.click(screen.getByRole("button", { name: "צור הצעה" }));

    await waitFor(() => expect(saveQuotation).toHaveBeenCalledWith("save_quotation", expect.objectContaining({
      p_quote_id: null,
      p_expected_version: 0,
      p_data: expect.objectContaining({ client_name: "לקוח בדיקה", client_phone: "0500000000" }),
    })));
    expect(quoteInsert).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "saved-quote" })));
  });

  test("keeps one request and disables submit while the save is in flight", async () => {
    let finish;
    saveQuotation.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onSaved = vi.fn();
    render(<QuoteFormDialog open onClose={vi.fn()} onSaved={onSaved} />);
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0], { target: { value: "לקוח בדיקה" } });
    fireEvent.change(textboxes[1], { target: { value: "0500000000" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
    fireEvent.click(await screen.findByRole("button", { name: /פיצה קיימת/ }));
    fireEvent.click(screen.getByRole("button", { name: "צור הצעה" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "שומר..." })).toBeDisabled());
    fireEvent.submit(document.querySelector("form"));
    expect(saveQuotation).toHaveBeenCalledTimes(1);
    finish({ data: { id: "saved-quote" }, error: null });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  test("shows a database permission error inside the form", async () => {
    saveQuotation.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    render(<QuoteFormDialog open onClose={vi.fn()} onSaved={vi.fn()} />);
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0], { target: { value: "לקוח בדיקה" } });
    fireEvent.change(textboxes[1], { target: { value: "0500000000" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
    fireEvent.click(await screen.findByRole("button", { name: /פיצה קיימת/ }));
    fireEvent.click(screen.getByRole("button", { name: "צור הצעה" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("אין הרשאה לשמור הצעת מחיר");
    expect(screen.getByRole("button", { name: "צור הצעה" })).not.toBeDisabled();
  });

  test("retries an unknown outcome with the same idempotency key", async () => {
    saveQuotation.mockRejectedValueOnce(new Error('network lost'));
    const onSaved = vi.fn();
    render(<QuoteFormDialog open onClose={vi.fn()} onSaved={onSaved} />);
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0], { target: { value: "לקוח בדיקה" } });
    fireEvent.change(textboxes[1], { target: { value: "0500000000" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
    fireEvent.click(await screen.findByRole("button", { name: /פיצה קיימת/ }));
    fireEvent.click(screen.getByRole("button", { name: "צור הצעה" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('תוצאת השמירה אינה ידועה');
    fireEvent.click(screen.getByRole("button", { name: "בדוק שוב" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(saveQuotation).toHaveBeenCalledTimes(2);
    expect(saveQuotation.mock.calls[0][1]).toEqual(saveQuotation.mock.calls[1][1]);
  });
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

    await waitFor(() => expect(saveQuotation).toHaveBeenCalledTimes(1));
    const payload = saveQuotation.mock.calls[0][1].p_data;
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
          quotation_version: 2,
          customer_id: "customer-1",
          customer_version: 3,
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

    await waitFor(() => expect(saveQuotation).toHaveBeenCalledTimes(1));
    expect(saveQuotation.mock.calls[0][1].p_data.selected_activities).toEqual([savedSnapshot]);
    expect(saveQuotation.mock.calls[0][1].p_quote_id).toBe("quote-1");
    expect(saveQuotation.mock.calls[0][1].p_expected_version).toBe(2);
    expect(saveQuotation.mock.calls[0][1].p_customer_id).toBe("customer-1");
    expect(saveQuotation.mock.calls[0][1].p_customer_version).toBe(3);
  });

  test('saves a legacy quotation as its first revision after the missing date is completed', async () => {
    render(<QuoteFormDialog open quote={{
      id: 'legacy-quote', quotation_version: 0, quotation_revision_id: null,
      client_name: 'Synthetic customer', client_phone: '0500000000',
      num_participants: 2, event_date: null, status: 'טיוטה',
      selected_activities: [{ item_type: 'activity', activity_id: 'activity-1',
        activity_name: 'Synthetic activity', price_per_person: 25 }],
    }} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-11-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'עדכון' }));
    await waitFor(() => expect(saveQuotation).toHaveBeenCalledWith('save_quotation', expect.objectContaining({
      p_quote_id: 'legacy-quote', p_expected_version: 0,
      p_data: expect.objectContaining({ event_date: '2026-11-05' }),
    })));
    expect(quoteUpdate).not.toHaveBeenCalled();
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
