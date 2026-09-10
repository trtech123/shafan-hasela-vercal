// @vitest-environment jsdom
/// <reference types="node" />

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AccountingOperations from "./AccountingOperations";

const fromMock = vi.fn();
const invokeMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    functions: { invoke: (...args) => invokeMock(...args) },
  },
}));
vi.mock("sonner", () => ({
  toast: {
    error: (...args) => toastError(...args),
    success: (...args) => toastSuccess(...args),
  },
}));

const rows = [
  {
    event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    source_type: "payment_transaction",
    source_id: "11111111-1111-4111-8111-111111111111",
    payment_transaction_id: "11111111-1111-4111-8111-111111111111",
    provider_transaction_id: "pelecard-8742",
    order_id: "22222222-2222-4222-8222-222222222222",
    order_number: "ORD-2042",
    sale_id: "33333333-3333-4333-8333-333333333333",
    local_receipt_number: "R-921",
    amount: "100.00",
    currency: "ILS",
    payment_status: "succeeded",
    payment_succeeded_at: "2026-09-09T10:00:00.000Z",
    accounting_status: "reconciliation_required",
    accounting_document_id: "doc-ledger-1",
    accounting_document_status: "reconciliation_required",
    external_document_number: "INV-456",
    document_url: "https://api.rivhit.co.il/pdf/INV-456",
    attempt_count: 2,
    last_error: { code: "rivhit_document_idempotency_mismatch", message: "Accounting requires manual reconciliation" },
    next_attempt_at: null,
    reconciliation_required: true,
    retry_allowed: false,
    created_at: "2026-09-09T10:00:01.000Z",
    updated_at: "2026-09-09T10:02:00.000Z",
  },
  {
    event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    source_type: "payment_transaction",
    source_id: "44444444-4444-4444-8444-444444444444",
    payment_transaction_id: "44444444-4444-4444-8444-444444444444",
    provider_transaction_id: "pelecard-8743",
    order_id: null,
    order_number: null,
    sale_id: "55555555-5555-4555-8555-555555555555",
    local_receipt_number: null,
    amount: "250.50",
    currency: "ILS",
    payment_status: "succeeded",
    payment_succeeded_at: "2026-09-09T09:00:00.000Z",
    accounting_status: "configuration_required",
    accounting_document_id: null,
    accounting_document_status: null,
    external_document_number: null,
    document_url: null,
    attempt_count: 1,
    last_error: { code: "missing_document_mapping", message: "Accounting configuration is incomplete" },
    next_attempt_at: null,
    reconciliation_required: false,
    retry_allowed: true,
    created_at: "2026-09-09T09:00:01.000Z",
    updated_at: "2026-09-09T09:01:00.000Z",
  },
];

function queryResult(result = { data: rows, error: null }) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(async () => result),
    update: updateMock,
    insert: insertMock,
    delete: deleteMock,
  };
  return builder;
}

beforeEach(() => {
  fromMock.mockReset();
  invokeMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  updateMock.mockReset();
  insertMock.mockReset();
  deleteMock.mockReset();
  fromMock.mockReturnValue(queryResult());
  invokeMock.mockResolvedValue({ data: { ok: true, status: "succeeded" }, error: null });
});

afterEach(cleanup);

describe("Accounting operations", () => {
  test("shows payment success independently beside an accounting failure", async () => {
    render(<AccountingOperations />);

    expect(await screen.findByRole("heading", { name: "בקרת הנה״ח" })).toBeInTheDocument();
    expect(screen.getAllByText("התשלום הצליח")).toHaveLength(2);
    expect(screen.getByText("ORD-2042")).toBeInTheDocument();
    expect(screen.getByText("pelecard-8742")).toBeInTheDocument();
    expect(screen.getByText(/R-921/)).toBeInTheDocument();
    expect(screen.getAllByText("נדרשת התאמה ידנית").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent("התשלום נשאר תקין");
    expect(screen.getByText("2 ניסיונות")).toBeInTheDocument();
    expect(screen.getByText("rivhit_document_idempotency_mismatch")).toBeInTheDocument();
  });

  test("shows a safe Rivhit document link and activation-required state", async () => {
    render(<AccountingOperations />);

    const link = await screen.findByRole("link", { name: /INV-456/ });
    expect(link).toHaveAttribute("href", "https://api.rivhit.co.il/pdf/INV-456");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText("נדרשת הפעלה והגדרה")).toBeInTheDocument();
    expect(screen.getByText("ללא הזמנה מקושרת")).toBeInTheDocument();
  });

  test("queries the read-only operations view newest-first without table writes", async () => {
    const builder = queryResult();
    fromMock.mockReturnValue(builder);
    render(<AccountingOperations />);

    await screen.findByText("ORD-2042");
    expect(fromMock).toHaveBeenCalledWith("payment_accounting_operations");
    expect(builder.select).toHaveBeenCalledOnce();
    expect(builder.order).toHaveBeenCalledWith("payment_succeeded_at", { ascending: false });
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  test("shows retry only from server eligibility and invokes the exact configuration payload", async () => {
    render(<AccountingOperations />);

    const retry = await screen.findByRole("button", { name: /ניסיון חוזר.*44444444/ });
    expect(screen.queryByRole("button", { name: /ניסיון חוזר.*11111111/ })).not.toBeInTheDocument();
    fireEvent.click(retry);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      "payment-accounting-worker",
      { body: { eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", forceRetry: true } },
    ));
    expect(retry).toBeDisabled();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("הנהלת החשבונות הופעלה מחדש"));
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("omits forceRetry for an eligible ordinary retry", async () => {
    const retryable = {
      ...rows[1],
      accounting_status: "retryable_error",
      retry_allowed: true,
      next_attempt_at: "2026-09-09T10:30:00.000Z",
    };
    fromMock.mockReturnValue(queryResult({ data: [retryable], error: null }));
    render(<AccountingOperations />);

    fireEvent.click(await screen.findByRole("button", { name: /ניסיון חוזר/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      "payment-accounting-worker",
      { body: { eventId: retryable.event_id } },
    ));
  });

  test("renders loading, empty, and load-error states", async () => {
    /** @type {(value: { data: unknown[], error: null }) => void} */
    let resolveLoad = () => {};
    const pending = new Promise((resolvePromise) => { resolveLoad = resolvePromise; });
    const loadingBuilder = queryResult();
    loadingBuilder.order.mockReturnValue(pending);
    fromMock.mockReturnValue(loadingBuilder);
    const view = render(<AccountingOperations />);
    expect(screen.getByText("טוען נתוני הנהלת חשבונות…")).toBeInTheDocument();

    resolveLoad({ data: [], error: null });
    expect(await screen.findByText("אין אירועי הנהלת חשבונות להצגה")).toBeInTheDocument();
    view.unmount();

    fromMock.mockReturnValue(queryResult({ data: null, error: new Error("denied") }));
    render(<AccountingOperations />);
    expect(await screen.findByRole("alert")).toHaveTextContent("לא ניתן לטעון את בקרת הנהלת החשבונות");
    expect(toastError).toHaveBeenCalledWith("לא הצלחנו לטעון את נתוני הנהלת החשבונות");
  });

  test("reports retry failure in Hebrew and refreshes after success only", async () => {
    invokeMock.mockResolvedValue({ data: { ok: false }, error: new Error("worker") });
    render(<AccountingOperations />);
    fireEvent.click(await screen.findByRole("button", { name: /ניסיון חוזר/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("הניסיון החוזר לא הושלם. אפשר לנסות שוב מאוחר יותר."));
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  test("declares the authenticated route", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src/App.jsx"), "utf8");
    expect(appSource).toContain('path="/accounting-operations"');
    expect(appSource).toContain("<AccountingOperations />");
  });
});
