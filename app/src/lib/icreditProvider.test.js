import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ICREDIT_TEST_BASE_URL,
  buildEnrollmentRequest,
  cancelRecurringSale,
  classifyIpn,
  createEventDigest,
  normalizeIpn,
  prepareVerifiedIpn,
  readEnrollmentResponse,
  verifyIpn,
} from "../../../supabase/functions/_shared/icredit.ts";

const agreementId = "91354a2b-a001-438a-8e9c-f54c1d91c734";
const recurringId = "617804f2-99d6-4ed9-8721-ecde4f92a715";
const saleId = "cc5be6fa-f0d1-4a6f-b466-3137ec65cf5d";
const groupToken = "a1408bfc-18da-49dc-aa77-d65870f7943e";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("iCredit TEST provider adapter", () => {
  test("builds hosted monthly recurring enrollment without document or card fields", () => {
    const payload = buildEnrollmentRequest({
      groupPrivateToken: groupToken,
      agreementId,
      clubName: "חוג טיפוס נוער",
      amount: 245,
      billingDay: 12,
      startsOn: "2026-10-01",
      firstName: "נועה",
      lastName: "לוי",
      phone: "0501234567",
      email: "noa@example.com",
      redirectUrl: "https://example.test/clubs/enrollment-complete",
      ipnUrl: "https://project.functions.supabase.co/club-recurring-ipn",
      failureIpnUrl: "https://project.functions.supabase.co/club-recurring-ipn",
    });

    expect(ICREDIT_TEST_BASE_URL).toBe("https://testicredit.rivhit.co.il");
    expect(payload).toMatchObject({
      GroupPrivateToken: groupToken,
      Items: [{ UnitPrice: 245, Quantity: 1, Description: "חברות חודשית - חוג טיפוס נוער" }],
      Custom1: agreementId,
      CreateRecurringSale: true,
      SaleType: 2,
      RecurringSaleCycle: 3,
      RecurringSaleStep: 1,
      RecurringSaleDay: 12,
      RecurringSaleCount: 0,
      RecurringSaleStartDate: "01-10-2026",
      RecurringSaleAutoCharge: true,
      RecurringSaleProRata: false,
      IPNMethod: 1,
      SendMail: false,
      CreateCustomer: false,
      CreateItems: false,
    });
    expect(payload.UniqueNum).toHaveLength(20);
    expect(payload.RequestReference).toBe(`club:${agreementId}`);

    for (const key of [
      "DocumentType",
      "ReceiptType",
      "CreditcardToken",
      "TransactionToken",
      "CardNumber",
      "CVV",
      "Expiry",
      "IdNumber",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  test("normalizes only allow-listed recurring IPN fields", () => {
    const normalized = normalizeIpn({
      SaleId: saleId,
      GroupPrivateToken: groupToken,
      Custom1: agreementId,
      RecurringId: recurringId,
      RecurringSaleChargeNumber: "4",
      RecurringSaleCount: "0",
      TransactionParamJ: "0",
      TransactionStatus: "0",
      TransactionAmount: "245.00",
      TransactionToken: "must-not-survive",
      TransactionCardNum: "458000XXXXXX0000",
      TransactionCardDueDateMMYY: "1029",
      TransactionCardHolderId: "123456789",
      CVV: "123",
    });

    expect(normalized).toEqual({
      saleId,
      groupPrivateToken: groupToken,
      agreementId,
      recurringId,
      chargeNumber: 4,
      recurringCount: 0,
      transactionParamJ: 0,
      transactionStatus: 0,
      transactionAmount: 245,
      failureCode: null,
      failureMessage: null,
    });
    const safe = JSON.stringify(normalized);
    expect(safe).not.toContain("must-not-survive");
    expect(safe).not.toContain("458000");
    expect(safe).not.toContain("123456789");
  });

  test("rejects malformed untrusted IPN identifiers and amounts", () => {
    expect(() => normalizeIpn({ SaleId: "not-a-uuid" })).toThrow(/SaleId/);
    expect(() => normalizeIpn({
      SaleId: saleId,
      GroupPrivateToken: groupToken,
      Custom1: agreementId,
      RecurringId: recurringId,
      RecurringSaleChargeNumber: "1",
      RecurringSaleCount: "0",
      TransactionParamJ: "0",
      TransactionStatus: "0",
      TransactionAmount: "-1",
    })).toThrow(/amount/i);
  });

  test("classifies creation, success, and failure only from valid recurring fields", () => {
    const base = {
      saleId,
      groupPrivateToken: groupToken,
      agreementId,
      recurringId,
      recurringCount: 0,
      transactionAmount: 245,
      failureCode: null,
      failureMessage: null,
    };

    expect(classifyIpn({ ...base, chargeNumber: 0, transactionParamJ: 5, transactionStatus: 0 })).toBe("agreement_created");
    expect(classifyIpn({ ...base, chargeNumber: 1, transactionParamJ: 0, transactionStatus: 0 })).toBe("charge_succeeded");
    expect(classifyIpn({ ...base, chargeNumber: 2, transactionParamJ: 0, transactionStatus: 4, failureMessage: "declined" })).toBe("charge_failed");
    expect(() => classifyIpn({ ...base, chargeNumber: 0, transactionParamJ: 0, transactionStatus: 0 })).toThrow(/unsupported/i);
  });

  test("requires official Verify response before accepting an IPN", async () => {
    const normalized = normalizeIpn({
      SaleId: saleId,
      GroupPrivateToken: groupToken,
      Custom1: agreementId,
      RecurringId: recurringId,
      RecurringSaleChargeNumber: "1",
      RecurringSaleCount: "0",
      TransactionParamJ: "0",
      TransactionStatus: "0",
      TransactionAmount: "245",
    });
    const rejectedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ Status: "NOT_VERIFIED" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(verifyIpn(rejectedFetch, {
      groupPrivateToken: groupToken,
      event: normalized,
      expectedAmount: 245,
    })).rejects.toThrow(/not verified/i);
    expect(rejectedFetch).toHaveBeenCalledWith(
      `${ICREDIT_TEST_BASE_URL}/API/PaymentPageRequest.svc/Verify`,
      expect.objectContaining({ method: "POST" }),
    );

    const acceptedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ Status: "VERIFIED" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(verifyIpn(acceptedFetch, {
      groupPrivateToken: groupToken,
      event: normalized,
      expectedAmount: 245,
    })).resolves.toBe(true);
  });

  test("prepares a verified creation IPN only after matching the local agreement", async () => {
    const verifiedFetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ Status: "VERIFIED" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const raw = {
      SaleId: saleId,
      GroupPrivateToken: groupToken,
      Custom1: agreementId,
      RecurringId: recurringId,
      RecurringSaleChargeNumber: "0",
      RecurringSaleCount: "0",
      TransactionParamJ: "5",
      TransactionStatus: "0",
      TransactionAmount: "245",
    };

    const prepared = await prepareVerifiedIpn(verifiedFetch, {
      raw,
      groupPrivateToken: groupToken,
      agreementId,
      providerRecurringId: null,
      expectedAmount: 245,
    });

    expect(prepared.kind).toBe("agreement_created");
    expect(prepared.event.recurringId).toBe(recurringId);
    expect(prepared.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(verifiedFetch).toHaveBeenCalledOnce();
  });

  test("rejects mismatched or unverified IPN before producing reconciliation input", async () => {
    const unverifiedFetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ Status: "NOT_VERIFIED" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const raw = {
      SaleId: saleId,
      GroupPrivateToken: groupToken,
      Custom1: agreementId,
      RecurringId: recurringId,
      RecurringSaleChargeNumber: "1",
      RecurringSaleCount: "0",
      TransactionParamJ: "0",
      TransactionStatus: "0",
      TransactionAmount: "245",
    };

    await expect(prepareVerifiedIpn(unverifiedFetch, {
      raw,
      groupPrivateToken: groupToken,
      agreementId: "06b61eef-9c17-41ba-9a21-6e83337ad798",
      providerRecurringId: null,
      expectedAmount: 245,
    })).rejects.toThrow(/agreement mismatch/i);
    expect(unverifiedFetch).not.toHaveBeenCalled();

    await expect(prepareVerifiedIpn(unverifiedFetch, {
      raw,
      groupPrivateToken: groupToken,
      agreementId,
      providerRecurringId: recurringId,
      expectedAmount: 245,
    })).rejects.toThrow(/not verified/i);
  });

  test("creates a stable digest from safe normalized fields", async () => {
    const event = normalizeIpn({
      SaleId: saleId,
      GroupPrivateToken: groupToken,
      Custom1: agreementId,
      RecurringId: recurringId,
      RecurringSaleChargeNumber: "1",
      RecurringSaleCount: "0",
      TransactionParamJ: "0",
      TransactionStatus: "0",
      TransactionAmount: "245",
    });

    const first = await createEventDigest(event, "charge_succeeded");
    const second = await createEventDigest(event, "charge_succeeded");
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test("accepts only a TEST hosted URL response", () => {
    expect(readEnrollmentResponse({
      Status: 0,
      URL: "https://testicredit.rivhit.co.il/payment/PaymentItems.aspx?Token=public",
      PrivateSaleToken: "do-not-return",
    })).toBe("https://testicredit.rivhit.co.il/payment/PaymentItems.aspx?Token=public");

    expect(() => readEnrollmentResponse({ Status: 0, URL: "https://icredit.rivhit.co.il/payment" })).toThrow(/TEST/i);
  });

  test("finalizes provider cancellation only for Status zero", async () => {
    const failedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ Status: 7, DebugMessage: "not cancelled" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(cancelRecurringSale(failedFetch, recurringId)).rejects.toThrow(/not cancelled/i);

    const successFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ Status: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(cancelRecurringSale(successFetch, recurringId)).resolves.toBe(true);
  });
});

describe("recurring Edge Function security boundaries", () => {
  test("authenticates admin enrollment and keeps the merchant identifier server-side", () => {
    const admin = readFileSync(resolve(repoRoot, "supabase/functions/_shared/admin.ts"), "utf8");
    const enroll = readFileSync(resolve(repoRoot, "supabase/functions/club-recurring-enroll/index.ts"), "utf8");

    expect(admin).toMatch(/auth\.getUser\(\)/);
    expect(admin).toMatch(/role[^\n]+admin/);
    expect(enroll).toMatch(/requireAdmin/);
    expect(enroll).toMatch(/Deno\.env\.get\("ICREDIT_GROUP_PRIVATE_TOKEN"\)/);
    expect(enroll).toMatch(/buildEnrollmentRequest/);
    expect(enroll).toMatch(/readEnrollmentResponse/);
    expect(enroll).not.toContain("https://icredit.rivhit.co.il");
  });

  test("verifies untrusted IPN before invoking the atomic reconciliation RPC", () => {
    const ipn = readFileSync(resolve(repoRoot, "supabase/functions/club-recurring-ipn/index.ts"), "utf8");

    expect(ipn).toMatch(/normalizeIpn/);
    expect(ipn).toMatch(/prepareVerifiedIpn/);
    expect(ipn).toMatch(/process_icredit_recurring_event/);
    expect(ipn.indexOf("prepareVerifiedIpn")).toBeLessThan(ipn.indexOf("process_icredit_recurring_event"));
    expect(ipn).not.toMatch(/console\.(?:log|info).*body/i);
  });

  test("cancels at iCredit before finalizing local cancellation", () => {
    const cancel = readFileSync(resolve(repoRoot, "supabase/functions/club-recurring-cancel/index.ts"), "utf8");

    expect(cancel).toMatch(/requireAdmin/);
    expect(cancel).toMatch(/cancelRecurringSale/);
    expect(cancel).toMatch(/cancel_icredit_recurring_membership/);
    expect(cancel).toMatch(/status:\s*"cancellation_pending"/);
    expect(cancel).toMatch(/status:\s*"active"/);
    expect(cancel.indexOf("cancelRecurringSale")).toBeLessThan(
      cancel.indexOf("cancel_icredit_recurring_membership"),
    );
  });
});
