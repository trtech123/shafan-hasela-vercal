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
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/api/supabaseClient", () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    functions: { invoke: (...args) => invokeMock(...args) },
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
  default_billing_day: 12,
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
    billing_day: 12,
    status: "pending_enrollment",
    payment_status: "not_enrolled",
    debt_amount: 0,
    participant: { id: "participant-1", first_name: "דן", last_name: "כהן", primary_contact_name: "רות כהן", primary_contact_phone: "0500000000" },
    agreement: { id: "agreement-1", status: "pending_enrollment", provider_recurring_id: null, last_charge_number: 0 },
  },
  {
    id: "membership-debt",
    club_id: "club-1",
    monthly_price: 245,
    billing_day: 12,
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

beforeEach(() => {
  toastError.mockReset();
  toastSuccess.mockReset();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  fromMock.mockReset();
  fromMock.mockImplementation((table) => {
    if (table === "clubs") return query(clubs);
    if (table === "instructors") return query([{ id: "instructor-1", full_name: "נועה מדריכה", status: "פעיל" }]);
    if (table === "club_schedule_rules") return query(rules);
    if (table === "club_memberships") return query(memberships);
    throw new Error(`Unexpected table ${table}`);
  });
  vi.stubGlobal("open", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Clubs admin workspace", () => {
  test("shows club schedule, participants, membership, payment, and debt state", async () => {
    render(<Clubs />);

    expect((await screen.findAllByText("חוג טיפוס נוער")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("נועה מדריכה").length).toBeGreaterThan(0);
    expect(screen.getByText("יום שני · 16:00–17:30")).toBeInTheDocument();
    expect(screen.getByText("יום חמישי · 17:00–18:00")).toBeInTheDocument();
    expect(screen.getByText("דן כהן")).toBeInTheDocument();
    expect(screen.getByText("נועה לוי")).toBeInTheDocument();
    expect(screen.getByText("חוב ₪245")).toBeInTheDocument();
  });

  test("starts hosted enrollment and opens only the TEST iCredit URL", async () => {
    invokeMock.mockResolvedValueOnce({
      data: { ok: true, agreementId: "agreement-1", url: "https://testicredit.rivhit.co.il/payment/PaymentItems.aspx?Token=public" },
      error: null,
    });
    render(<Clubs />);

    fireEvent.click(await screen.findByRole("button", { name: "התחלת הוראת קבע עבור דן כהן" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("club-recurring-enroll", {
      body: { membershipId: "membership-pending" },
    }));
    expect(window.open).toHaveBeenCalledWith(
      "https://testicredit.rivhit.co.il/payment/PaymentItems.aspx?Token=public",
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("keeps local state active when provider cancellation fails", async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: false, error: "provider declined cancellation" }, error: null });
    render(<Clubs />);

    fireEvent.click(await screen.findByRole("button", { name: "ביטול חברות עבור נועה לוי" }));
    fireEvent.click(screen.getByRole("button", { name: "אישור ביטול מיידי" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("provider declined cancellation"));
    expect(screen.getByText("נועה לוי")).toBeInTheDocument();
    expect(screen.getByText("פעילה")).toBeInTheDocument();
  });

  test("reloads local membership state after provider cancellation succeeds", async () => {
    render(<Clubs />);
    await screen.findByText("נועה לוי");
    const initialCalls = fromMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "ביטול חברות עבור נועה לוי" }));
    fireEvent.click(screen.getByRole("button", { name: "אישור ביטול מיידי" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("club-recurring-cancel", {
      body: { membershipId: "membership-debt" },
    }));
    await waitFor(() => expect(fromMock.mock.calls.length).toBeGreaterThan(initialCalls));
  });

  test("cancels a pending hosted enrollment through the server boundary", async () => {
    render(<Clubs />);

    fireEvent.click(await screen.findByRole("button", { name: "ביטול חברות עבור דן כהן" }));
    fireEvent.click(screen.getByRole("button", { name: "אישור ביטול מיידי" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("club-recurring-cancel", {
      body: { membershipId: "membership-pending" },
    }));
  });

  test("declares the Clubs route and navigation as admin-only", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const appSource = readFileSync(resolve(repoRoot, "app/src/App.jsx"), "utf8");
    const layoutSource = readFileSync(resolve(repoRoot, "app/src/components/Layout.jsx"), "utf8");

    expect(appSource).toMatch(/path="\/clubs"[^>]+<Clubs/);
    expect(layoutSource).toMatch(/path:\s*"\/clubs"[\s\S]*?roles:\s*\["admin"\]/);
  });
});
