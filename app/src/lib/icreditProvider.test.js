import { describe, expect, test, vi } from "vitest";
import {
  ICREDIT_TEST_BASE_URL,
  buildEnrollmentRequest,
  cancelRecurringSale,
  classifyIpn,
  createEventDigest,
  normalizeIpn,
  readEnrollmentResponse,
  verifyIpn,
} from "../../../supabase/functions/_shared/icredit.ts";

const agreementId = "91354a2b-a001-438a-8e9c-f54c1d91c734";
const recurringId = "617804f2-99d6-4ed9-8721-ecde4f92a715";
const saleId = "cc5be6fa-f0d1-4a6f-b466-3137ec65cf5d";
const groupToken = "a1408bfc-18da-49dc-aa77-d65870f7943e";

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
