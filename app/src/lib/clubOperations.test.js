import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BILLING_DAY,
  attendancePaymentState,
  buildCancellationPreview,
  buildMembershipRegistration,
  failedPaymentMessage,
  recurringStartForJoin,
} from "./clubDomain";

describe("Clubs confirmed operational rules", () => {
  test("keeps payer/parent separate from participant/child and preserves contact data", () => {
    const registration = buildMembershipRegistration({
      first_name: "נועה", last_name: "לוי", starts_on: "2026-09-18",
      payer_name: "רונית לוי", payer_relationship: "אמא",
      payer_phone: "0501234567", payer_email: "parent@example.com",
      monthly_price: "245",
    }, { id: "club-1", monthly_price: 245 });

    expect(registration.participant).toMatchObject({
      first_name: "נועה", last_name: "לוי", payer_name: "רונית לוי",
      payer_relationship: "אמא", payer_phone: "0501234567",
      payer_email: "parent@example.com",
    });
    expect(registration.membership.billing_day).toBe(BILLING_DAY);
  });

  test("starts recurring on the following month and requires manual current-month settlement", () => {
    expect(recurringStartForJoin("2026-09-18")).toBe("2026-10-01");
    const registration = buildMembershipRegistration({
      first_name: "דן", last_name: "כהן", starts_on: "2026-09-18", monthly_price: 245,
    }, { id: "club-1", monthly_price: 245 });
    expect(registration.membership).toMatchObject({
      billing_day: 15,
      recurring_starts_on: "2026-10-01",
      current_month_settlement_status: "manual_required",
    });
    expect(registration.membership).not.toHaveProperty("prorated_amount");
  });

  test("handles December to January for recurring start", () => {
    expect(recurringStartForJoin("2026-12-22")).toBe("2027-01-01");
  });

  test.each([
    ["2026-09-10", "2026-10-01"],
    ["2026-09-11", "2026-11-01"],
    ["2026-12-11", "2027-02-01"],
  ])("calculates cancellation requested %s as %s", (requestedOn, effectiveOn) => {
    expect(buildCancellationPreview(requestedOn).effectiveOn).toBe(effectiveOn);
  });

  test.each([
    ["succeeded", "settled", "שולם", "✓"],
    ["failed", "failed", "לא שולם", "✕"],
    [null, "unknown", "לא אומת", "—"],
  ])("maps provider charge %s to attendance state", (chargeStatus, state, label, symbol) => {
    expect(attendancePaymentState(chargeStatus)).toEqual({ state, label, symbol });
  });

  test("failed-payment follow-up tells the payer to contact the office", () => {
    expect(failedPaymentMessage("רונית")).toContain("התשלום נכשל");
    expect(failedPaymentMessage("רונית")).toContain("לפנות למשרד");
    expect(failedPaymentMessage("רונית")).toContain("כרטיס האשראי");
  });

  test("uses payer identity for iCredit enrollment and has no Clubs accounting handoff", () => {
    const enroll = readFileSync(resolve(process.cwd(), "../supabase/functions/club-recurring-enroll/index.ts"), "utf8");
    const ipn = readFileSync(resolve(process.cwd(), "../supabase/functions/club-recurring-ipn/index.ts"), "utf8");
    expect(enroll).toMatch(/payer_name/);
    expect(enroll).toMatch(/payer_phone/);
    expect(`${enroll}\n${ipn}`).not.toMatch(/rivhit-accounting|accounting_document|create.*receipt|create.*invoice/i);
  });
});
