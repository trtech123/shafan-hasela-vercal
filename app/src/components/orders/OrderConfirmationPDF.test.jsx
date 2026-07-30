// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import OrderConfirmationPDF from "./OrderConfirmationPDF";

const invokeMock = vi.fn();

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    functions: {
      invoke: (...args) => invokeMock(...args),
    },
  },
}));

vi.mock("html2canvas", () => ({
  default: vi.fn(async () => ({
    width: 100,
    height: 100,
    toDataURL: () => "data:image/jpeg;base64,cGRm",
  })),
}));

vi.mock("jspdf", () => ({
  default: vi.fn(function MockJsPdf() {
    return {
      internal: {
        pageSize: {
          getWidth: () => 210,
          getHeight: () => 297,
        },
      },
      addImage: vi.fn(),
      addPage: vi.fn(),
      output: () => "data:application/pdf;base64,cGRm",
      save: vi.fn(),
    };
  }),
}));

const order = {
  id: "order-1",
  order_number: "ORD-1",
  client_name: "לקוח בדיקה",
  client_email: "original@example.com",
  activity_date: "2026-08-01",
  num_participants: 4,
  total_price: 400,
};

const activity = {
  name: "פעילות בדיקה",
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { ok: true }, error: null });

  class ReadyImage {
    decode() {
      return Promise.resolve();
    }

    set src(_value) {
      queueMicrotask(() => this.onload?.());
    }
  }

  vi.stubGlobal("Image", ReadyImage);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OrderConfirmationPDF recipient email", () => {
  test("shows a valid recipient in compact mode by default", () => {
    render(<OrderConfirmationPDF order={order} activity={activity} onClose={() => {}} />);

    expect(screen.getAllByText("original@example.com")).toHaveLength(2);
    expect(screen.queryByLabelText("כתובת אימייל לשליחה")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "עריכת כתובת אימייל" })).toBeInTheDocument();
  });

  test("opens from the pencil and Done saves a valid trimmed recipient", () => {
    render(<OrderConfirmationPDF order={order} activity={activity} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "עריכת כתובת אימייל" }));
    const input = screen.getByLabelText("כתובת אימייל לשליחה");
    expect(input).toHaveValue("original@example.com");

    fireEvent.change(input, { target: { value: "  new@example.com  " } });
    fireEvent.click(screen.getByRole("button", { name: "סיום" }));

    expect(screen.queryByLabelText("כתובת אימייל לשליחה")).not.toBeInTheDocument();
    expect(screen.getByText("new@example.com")).toBeInTheDocument();
  });

  test("keeps the editor open when Done receives an invalid recipient", async () => {
    render(<OrderConfirmationPDF order={order} activity={activity} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "עריכת כתובת אימייל" }));
    const input = screen.getByLabelText("כתובת אימייל לשליחה");
    fireEvent.change(input, { target: { value: "new@example.com" } });
    fireEvent.change(input, { target: { value: "invalid-email" } });
    fireEvent.click(screen.getByRole("button", { name: "סיום" }));

    expect(screen.getByLabelText("כתובת אימייל לשליחה")).toHaveValue("invalid-email");
    expect(await screen.findByRole("alert")).toHaveTextContent("כתובת האימייל אינה תקינה");
  });

  test("opens the editor with the required message for an empty initial recipient", async () => {
    render(
      <OrderConfirmationPDF
        order={{ ...order, client_email: "" }}
        activity={activity}
        onClose={() => {}}
      />
    );

    expect(screen.getByLabelText("כתובת אימייל לשליחה")).toHaveValue("");
    expect(await screen.findByRole("alert")).toHaveTextContent("יש להזין כתובת אימייל");
  });

  test("opens the editor with the format message for an invalid initial recipient", async () => {
    render(
      <OrderConfirmationPDF
        order={{ ...order, client_email: "invalid-email" }}
        activity={activity}
        onClose={() => {}}
      />
    );

    expect(screen.getByLabelText("כתובת אימייל לשליחה")).toHaveValue("invalid-email");
    expect(await screen.findByRole("alert")).toHaveTextContent("כתובת האימייל אינה תקינה");
  });

  test("blocks Send and keeps the editor open for an invalid edit", async () => {
    render(<OrderConfirmationPDF order={order} activity={activity} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "עריכת כתובת אימייל" }));
    fireEvent.change(screen.getByLabelText("כתובת אימייל לשליחה"), {
      target: { value: "invalid-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "שלח במייל" }));

    expect(screen.getByLabelText("כתובת אימייל לשליחה")).toHaveValue("invalid-email");
    expect(await screen.findByRole("alert")).toHaveTextContent("כתובת האימייל אינה תקינה");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("sends to a valid recipient saved from edit mode", async () => {
    render(<OrderConfirmationPDF order={order} activity={activity} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "עריכת כתובת אימייל" }));
    fireEvent.change(screen.getByLabelText("כתובת אימייל לשליחה"), {
      target: { value: "  new@example.com  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "סיום" }));
    fireEvent.click(screen.getByRole("button", { name: "שלח במייל" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "send-order-doc",
        expect.objectContaining({
          body: expect.objectContaining({ to: "new@example.com" }),
        })
      );
    });
  });
});
