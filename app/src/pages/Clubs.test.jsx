// @vitest-environment jsdom
/// <reference types="node" />

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Clubs from "./Clubs";

const fromMock = vi.fn();
const invokeMock = vi.fn();
const rpcMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    functions: { invoke: (...args) => invokeMock(...args) },
    rpc: (...args) => rpcMock(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: (...args) => toastError(...args), success: (...args) => toastSuccess(...args) },
}));

const clubs = [{
  id: "club-1",
  name: "חוג טיפוס נוער",
  description: "אימון שבועי",
  instructor_id: "instructor-1",
  instructor: { id: "instructor-1", full_name: "נועה מדריכה" },
  site: "עכו",
  capacity: 14,
  monthly_price: 245,
  default_billing_day: 15,
  status: "active",
}];

const rules = [
  { id: "rule-1", club_id: "club-1", weekday: 1, start_time: "16:00:00", end_time: "17:30:00", is_active: true },
  { id: "rule-2", club_id: "club-1", weekday: 4, start_time: "17:00:00", end_time: "18:00:00", is_active: true },
];

const memberships = [
  {
    id: "membership-pending",
    club_id: "club-1",
    monthly_price: 245,
    billing_day: 15,
    recurring_starts_on: "2026-10-01",
    current_month_settlement_status: "manual_required",
    status: "pending_enrollment",
    payment_status: "not_enrolled",
    debt_amount: 0,
    participant: { id: "participant-1", first_name: "דן", last_name: "כהן", payer_name: "רות כהן", payer_phone: "0500000000" },
    agreement: { id: "agreement-1", status: "pending_enrollment", provider_recurring_id: null, last_charge_number: 0 },
  },
  {
    id: "membership-debt",
    club_id: "club-1",
    monthly_price: 245,
    billing_day: 15,
    recurring_starts_on: "2026-09-01",
    current_month_settlement_status: "not_required",
    status: "active",
    payment_status: "past_due",
    debt_amount: 245,
    participant: { id: "participant-2", first_name: "נועה", last_name: "לוי", primary_contact_name: null, phone: "0520000000" },
    agreement: { id: "agreement-2", status: "active", provider_recurring_id: "617804f2-99d6-4ed9-8721-ecde4f92a715", last_charge_number: 3 },
  },
];

function query(data) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(async () => ({ data, error: null })),
  };
  return builder;
}

function failedQuery(message = "relation does not exist") {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(async () => ({ data: null, error: { message } })),
  };
  return builder;
}

beforeEach(() => {
  toastError.mockReset();
  toastSuccess.mockReset();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: { effective_on: "2026-11-01" }, error: null });
  fromMock.mockReset();
  fromMock.mockImplementation((table) => {
    if (table === "clubs") return query(clubs);
    if (table === "instructors") return query([{ id: "instructor-1", full_name: "נועה מדריכה", status: "פעיל" }]);
    if (table === "club_schedule_rules") return query(rules);
    if (table === "club_memberships") return query(memberships);
    if (table === "club_attendance_operations") return query([
      { session_id: "session-1", membership_id: "membership-pending", club_id: "club-1", participant_name: "דן כהן", session_date: "2026-09-07", start_time: "16:00", attendance_status: "present", provider_charge_status: "succeeded" },
      { session_id: "session-1", membership_id: "membership-debt", club_id: "club-1", participant_name: "נועה לוי", session_date: "2026-09-07", start_time: "16:00", attendance_status: "absent", provider_charge_status: "failed" },
      { session_id: "session-2", membership_id: "membership-pending", club_id: "club-1", participant_name: "דן כהן", session_date: "2026-10-07", start_time: "16:00", attendance_status: null, provider_charge_status: null },
    ]);
    if (table === "club_payment_follow_ups") return query([{ id: "follow-1", membership_id: "membership-debt", payer_name: "אמא לוי", status: "pending", message: "התשלום נכשל. יש לפנות למשרד לעדכון כרטיס האשראי." }]);
    throw new Error(`Unexpected table ${table}`);
  });
  vi.stubGlobal("open", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Clubs admin workspace", () => {
  test("shows an in-page Hebrew error when Clubs data cannot load", async () => {
    fromMock.mockImplementation(() => failedQuery());

    render(<Clubs />);

    expect(await screen.findByRole("alert")).toHaveTextContent("לא ניתן לטעון את נתוני החוגים");
    expect(screen.getByRole("button", { name: "נסה שוב" })).toBeInTheDocument();
  });

  test("shows club schedule, participants, membership, payment, and debt state", async () => {
    render(<Clubs />);

    expect((await screen.findAllByText("חוג טיפוס נוער")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("נועה מדריכה").length).toBeGreaterThan(0);
    expect(screen.getByText("יום שני · 16:00–17:30")).toBeInTheDocument();
    expect(screen.getByText("יום חמישי · 17:00–18:00")).toBeInTheDocument();
    expect(screen.getAllByText("דן כהן").length).toBeGreaterThan(0);
    expect(screen.getAllByText("נועה לוי").length).toBeGreaterThan(0);
    expect(screen.getByText("חוב ₪245")).toBeInTheDocument();
  });

  test("obsolete iCredit labels and provider controls are absent", async () => {
    render(<Clubs />);
    await screen.findAllByText('חוג טיפוס נוער');
    expect(document.body).not.toHaveTextContent(/iCredit/i);
    expect(screen.queryByRole('button',{name:/התחלת הוראת קבע|השלמת ביטול/})).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'רישום משתתף'}));
    expect(document.body).not.toHaveTextContent(/iCredit/i);
  });

  test("shows the calculated effective date before scheduling cancellation", async () => {
    render(<Clubs />);

    fireEvent.click(await screen.findByRole("button", { name: "ביטול חברות עבור נועה לוי" }));
    expect(screen.getByText(/תסיים את החברות החל מ־/)).toBeInTheDocument();
  });

  test("schedules cancellation through the deterministic database boundary", async () => {
    render(<Clubs />);
    await screen.findAllByText("נועה לוי");
    const initialCalls = fromMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "ביטול חברות עבור נועה לוי" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירת בקשת ביטול" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("request_club_membership_cancellation", expect.objectContaining({ p_membership_id: "membership-debt" })));
    await waitFor(() => expect(fromMock.mock.calls.length).toBeGreaterThan(initialCalls));
  });

  test("schedules a pending hosted enrollment without calling a provider early", async () => {
    render(<Clubs />);

    fireEvent.click(await screen.findByRole("button", { name: "ביטול חברות עבור דן כהן" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירת בקשת ביטול" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("request_club_membership_cancellation", expect.objectContaining({ p_membership_id: "membership-pending" })));
    expect(invokeMock).not.toHaveBeenCalledWith("club-recurring-cancel", expect.anything());
  });

  test("hides legacy provider attendance badges and preserves historical follow-ups", async () => {
    render(<Clubs />);
    await screen.findAllByText('חוג טיפוס נוער');
    expect(screen.queryByText("✓ שולם")).not.toBeInTheDocument();
    expect(screen.queryByText("✕ לא שולם")).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'מפגשים ונוכחות'})).toHaveAttribute('href','/club-attendance');
    expect(screen.getByText(/ממתין לטיפול/)).toBeInTheDocument();
  });

  test("declares the Clubs route and navigation as admin-only", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const appSource = readFileSync(resolve(repoRoot, "app/src/App.jsx"), "utf8");
    const layoutSource = readFileSync(resolve(repoRoot, "app/src/components/Layout.jsx"), "utf8");

    expect(appSource).toMatch(/path="\/clubs"[^>]+<Clubs/);
    expect(layoutSource).toMatch(/path:\s*"\/clubs"[\s\S]*?roles:\s*\["admin"\]/);
  });
});
