// @vitest-environment jsdom
/// <reference types="node" />

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ChatbotHandoffs from "./ChatbotHandoffs";

const fromMock = vi.fn();
const invokeMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    functions: { invoke: (...args) => invokeMock(...args) },
  },
}));
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", role: "אחמ\"ש", full_name: "נועה" } }),
}));
vi.mock("sonner", () => ({
  toast: { error: (...args) => toastError(...args), success: (...args) => toastSuccess(...args) },
}));

const handoffs = [
  {
    id: "handoff-waiting",
    conversation_id: "conversation-1",
    lead_id: "lead-1",
    reason: "specific_price",
    priority: "normal",
    summary: "כמה עולה לקבוצה?",
    customer_name: "דנה כהן",
    callback_phone: "+972501234567",
    requested_site: "acre_extreme_park",
    group_size: "small",
    status: "waiting",
    assigned_to: null,
    created_at: "2026-09-08T12:00:00.000Z",
    assignee: null,
    conversation: { id: "conversation-1", channel: "whatsapp", status: "awaiting_human", contact: { display_name: "דנה כהן", phone: "+972501234567", email: null } },
  },
  {
    id: "handoff-active",
    conversation_id: "conversation-2",
    lead_id: "lead-2",
    reason: "complaint_or_problem",
    priority: "high",
    summary: "יש בעיה בפעילות",
    customer_name: "יוסי לוי",
    callback_phone: "+972509999999",
    status: "active",
    assigned_to: "user-1",
    created_at: "2026-09-08T11:00:00.000Z",
    assignee: { full_name: "נועה" },
    conversation: { id: "conversation-2", channel: "whatsapp", status: "human_active", contact: { display_name: "יוסי לוי", phone: "+972509999999", email: null } },
  },
];

function queryResult(data) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(async () => ({ data, error: null })),
  };
  return builder;
}

beforeEach(() => {
  fromMock.mockReset();
  invokeMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  fromMock.mockImplementation((table) => {
    if (table === "bot_handoffs") return queryResult(handoffs);
    if (table === "bot_messages") return queryResult([
      { id: "message-1", direction: "inbound", message_kind: "text", body: "כמה עולה לקבוצה?", delivery_status: null, occurred_at: "2026-09-08T12:00:00.000Z" },
      { id: "message-2", direction: "outbound", message_kind: "text", body: "נשמח לעזור", delivery_status: "delivered", occurred_at: "2026-09-08T12:00:01.000Z" },
    ]);
    throw new Error(`Unexpected table ${table}`);
  });
});

afterEach(cleanup);

describe("Chatbot handoff queue", () => {
  test("shows queue states, captured fields, and transcript", async () => {
    render(<ChatbotHandoffs />);

    expect(await screen.findByText("תור שפן")).toBeInTheDocument();
    expect((await screen.findAllByText("דנה כהן")).length).toBeGreaterThan(0);
    expect(screen.getByText("יוסי לוי")).toBeInTheDocument();
    expect(screen.getAllByText("ממתין לטיפול").length).toBeGreaterThan(0);
    expect(screen.getAllByText("בטיפול").length).toBeGreaterThan(0);
    expect(await screen.findByText("נשמח לעזור")).toBeInTheDocument();
    expect(screen.getByText("ליד lead-1")).toBeInTheDocument();
  });

  test("claims a waiting handoff only through the admin Edge Function", async () => {
    render(<ChatbotHandoffs />);
    fireEvent.click(await screen.findByRole("button", { name: "קבלת טיפול" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("chatbot-handoff-admin", {
      body: { action: "claim", handoffId: "handoff-waiting" },
    }));
    expect(toastSuccess).toHaveBeenCalled();
  });

  test("sends replies and exposes explicit resume/resolve/close controls for the assignee", async () => {
    render(<ChatbotHandoffs />);
    fireEvent.click(await screen.findByRole("button", { name: /יוסי לוי/ }));

    fireEvent.change(screen.getByPlaceholderText("כתיבת תשובה ללקוח…"), { target: { value: "אנחנו מטפלים בזה" } });
    fireEvent.click(screen.getByRole("button", { name: "שליחת תשובה" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("chatbot-handoff-admin", {
      body: { action: "reply", handoffId: "handoff-active", message: "אנחנו מטפלים בזה" },
    }));

    expect(screen.getByRole("button", { name: "החזרת הבוט לפעילות" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "סימון כטופל" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "סגירת שיחה" })).toBeInTheDocument();
  });

  test("declares the queue route and navigation for admin and operations only", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const appSource = readFileSync(resolve(root, "app/src/App.jsx"), "utf8");
    const layoutSource = readFileSync(resolve(root, "app/src/components/Layout.jsx"), "utf8");

    expect(appSource).toMatch(/path="\/chatbot-handoffs"[^>]+<ChatbotHandoffs/);
    expect(layoutSource).toMatch(/path:\s*"\/chatbot-handoffs"[\s\S]*?roles:\s*\["admin", "אחמ\\"ש"\]/);
  });
});
