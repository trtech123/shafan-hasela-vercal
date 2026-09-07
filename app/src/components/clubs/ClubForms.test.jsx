// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ClubFormDialog from "./ClubFormDialog";
import MemberRegistrationDialog from "./MemberRegistrationDialog";

const fromMock = vi.fn();
const rpcMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/api/supabaseClient", () => ({
  supabase: { from: (...args) => fromMock(...args), rpc: (...args) => rpcMock(...args) },
}));

vi.mock("sonner", () => ({
  toast: { success: (...args) => toastSuccess(...args), error: (...args) => toastError(...args) },
}));

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: "club-1", error: null });
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(cleanup);

describe("ClubFormDialog", () => {
  test("creates a club with multiple weekly schedule rules", async () => {
    render(
      <ClubFormDialog
        open
        onClose={vi.fn()}
        club={null}
        scheduleRules={[]}
        instructors={[{ id: "instructor-1", full_name: "נועה מדריכה" }]}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("שם החוג"), { target: { value: "חוג נוער" } });
    fireEvent.change(screen.getByLabelText("מחיר חודשי"), { target: { value: "245" } });
    fireEvent.change(screen.getByLabelText("יום חיוב"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("שעת התחלה 1"), { target: { value: "16:00" } });
    fireEvent.change(screen.getByLabelText("שעת סיום 1"), { target: { value: "17:30" } });

    fireEvent.click(screen.getByRole("button", { name: "הוספת מפגש שבועי" }));
    expect(screen.getAllByLabelText(/יום בשבוע/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("שעת התחלה 2"), { target: { value: "17:00" } });
    fireEvent.change(screen.getByLabelText("שעת סיום 2"), { target: { value: "18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירת חוג" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("save_club_with_schedule", expect.objectContaining({
      p_club_id: null,
      p_name: "חוג נוער",
      p_monthly_price: 245,
      p_rules: [
        expect.objectContaining({ start_time: "16:00", end_time: "17:30" }),
        expect.objectContaining({ start_time: "17:00", end_time: "18:00" }),
      ],
    })));
  });

  test("prefills edit mode with existing rules", () => {
    render(
      <ClubFormDialog
        open
        onClose={vi.fn()}
        club={{
          id: "club-1",
          name: "חוג קיים",
          description: null,
          instructor_id: null,
          site: "עכו",
          capacity: 12,
          monthly_price: 200,
          default_billing_day: 5,
          status: "active",
          notes: null,
        }}
        scheduleRules={[
          { id: "rule-1", weekday: 1, start_time: "16:00:00", end_time: "17:30:00" },
          { id: "rule-2", weekday: 4, start_time: "17:00:00", end_time: "18:00:00" },
        ]}
        instructors={[]}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("שם החוג")).toHaveValue("חוג קיים");
    expect(screen.getAllByLabelText(/יום בשבוע/)).toHaveLength(2);
  });

  test("updates a club and replaces its recurring schedule rules", async () => {
    render(
      <ClubFormDialog
        open
        onClose={vi.fn()}
        club={{
          id: "club-1", name: "חוג קיים", description: null, instructor_id: null,
          site: "עכו", capacity: 12, monthly_price: 200, default_billing_day: 5,
          status: "active", notes: null,
        }}
        scheduleRules={[{ id: "rule-1", weekday: 1, start_time: "16:00:00", end_time: "17:30:00" }]}
        instructors={[]}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("שם החוג"), { target: { value: "חוג מעודכן" } });
    fireEvent.change(screen.getByLabelText("מחיר חודשי"), { target: { value: "225" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירת חוג" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("save_club_with_schedule", expect.objectContaining({
      p_club_id: "club-1",
      p_name: "חוג מעודכן",
      p_monthly_price: 225,
      p_rules: [expect.objectContaining({ weekday: 1 })],
    })));
  });
});

describe("MemberRegistrationDialog", () => {
  test("creates participant and membership with snapshotted price", async () => {
    const participantInsert = vi.fn(() => ({
      select: () => ({ single: async () => ({ data: { id: "participant-1" }, error: null }) }),
    }));
    const membershipInsert = vi.fn(async () => ({ error: null }));
    fromMock.mockImplementation((table) => {
      if (table === "club_participants") return { insert: participantInsert, delete: vi.fn() };
      if (table === "club_memberships") return { insert: membershipInsert };
      throw new Error(`Unexpected table ${table}`);
    });

    render(
      <MemberRegistrationDialog
        open
        onClose={vi.fn()}
        club={{ id: "club-1", name: "חוג נוער", monthly_price: 245, default_billing_day: 12 }}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("שם פרטי"), { target: { value: "נועה" } });
    fireEvent.change(screen.getByLabelText("שם משפחה"), { target: { value: "לוי" } });
    fireEvent.click(screen.getByRole("button", { name: "רישום משתתף" }));

    await waitFor(() => expect(membershipInsert).toHaveBeenCalled());
    expect(membershipInsert).toHaveBeenCalledWith(expect.objectContaining({
      club_id: "club-1",
      participant_id: "participant-1",
      monthly_price: 245,
      billing_day: 12,
      status: "pending_enrollment",
    }));
  });
});
