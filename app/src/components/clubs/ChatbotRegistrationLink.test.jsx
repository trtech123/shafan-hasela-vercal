// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ChatbotRegistrationLink from "./ChatbotRegistrationLink";
import { israelRegistrationMonth } from "../../../../supabase/functions/_shared/chatbot/registration-link.js";

const state = vi.hoisted(() => ({ role: "admin", queries: [], saved: [] }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin-1", role: state.role } }) }));
vi.mock("@/api/supabaseClient", () => ({ supabase: { from: () => ({
  select: () => ({ order: async () => ({ data: state.queries, error: null }) }),
  upsert: async (row) => { state.saved.push(row); return { error: null }; },
}) } }));

beforeEach(() => { state.role = "admin"; state.queries = []; state.saved = []; });
afterEach(() => cleanup());

describe("Clubs monthly registration admin", () => {
  test("shows the active Israel-month URL to the admin", async () => {
    const month = israelRegistrationMonth();
    state.queries = [{ registration_month: `${month}-01`, url: "https://example.org/current" }];
    render(<ChatbotRegistrationLink />);
    expect(await screen.findByText("https://example.org/current")).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(month)).length).toBeGreaterThan(0);
  });
  test("admin chooses a month and saves a validated replacement", async () => {
    render(<ChatbotRegistrationLink />);
    const month = await screen.findByLabelText("חודש הרשמה");
    fireEvent.change(month, { target: { value: "2026-11" } });
    fireEvent.change(screen.getByLabelText("קישור הרשמה ותשלום"), { target: { value: "https://example.org/nov" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירת קישור" }));
    await waitFor(() => expect(state.saved).toEqual([{
      registration_month: "2026-11-01", url: "https://example.org/nov", updated_by: "admin-1",
    }]));
  });

  test("rejects unsafe links and hides control from non-admins", async () => {
    const view = render(<ChatbotRegistrationLink />);
    await screen.findByLabelText("חודש הרשמה");
    fireEvent.change(screen.getByLabelText("קישור הרשמה ותשלום"), { target: { value: "http://example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירת קישור" }));
    expect(state.saved).toEqual([]);
    view.unmount();
    state.role = "operations";
    render(<ChatbotRegistrationLink />);
    expect(screen.queryByLabelText("קישור הרשמה ותשלום")).not.toBeInTheDocument();
  });
});
