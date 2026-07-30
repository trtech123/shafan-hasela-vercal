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
  test("prefills the recipient from the order and allows editing", () => {
    render(<OrderConfirmationPDF order={order} activity={activity} onClose={() => {}} />);

    const input = screen.getByLabelText("כתובת אימייל לשליחה");
    expect(input).toHaveValue("original@example.com");

    fireEvent.change(input, { target: { value: "new@example.com" } });
    expect(input).toHaveValue("new@example.com");
  });

  test("shows the required message and prevents sending when empty", async () => {
    render(
      <OrderConfirmationPDF
        order={{ ...order, client_email: "" }}
        activity={activity}
        onClose={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "שלח במייל" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("יש להזין כתובת אימייל");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("shows the format message and prevents sending when invalid", async () => {
    render(
      <OrderConfirmationPDF
        order={{ ...order, client_email: "invalid-email" }}
        activity={activity}
        onClose={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "שלח במייל" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("כתובת האימייל אינה תקינה");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("sends to the edited, trimmed valid recipient", async () => {
    render(<OrderConfirmationPDF order={order} activity={activity} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("כתובת אימייל לשליחה"), {
      target: { value: "  new@example.com  " },
    });
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
