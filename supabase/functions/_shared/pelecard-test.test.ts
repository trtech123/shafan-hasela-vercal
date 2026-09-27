import { describe, expect, test, vi } from "vitest";
import { assertCommercialPaymentsDisabled, readPelecardTestConfig } from "./pelecard-test-config.ts";
import { createPelecardTestProvider, PELECARD_TEST_ENDPOINTS } from "./pelecard-test-provider.ts";

// Synthetic sentinels only; these are not provider credentials.
const env: Record<string, string> = {
  PELECARD_MODE: "test",
  PELECARD_TEST_USER: "synthetic-test-user",
  PELECARD_TEST_PASSWORD: "synthetic-test-password",
  PELECARD_TEST_TERMINAL: "synthetic-test-terminal",
};
const id = "a0000000-0000-4000-8000-000000000001";
const transactionId = "b0000000-0000-4000-8000-000000000002";
const confirmationKey = "synthetic-confirmation-key";
const config = () => readPelecardTestConfig((key) => env[key]);
const evidence = () => ({
  StatusCode: "000", ErrorMessage: "operation success",
  ResultData: {
    TransactionId: transactionId, ShvaResult: "000", JParam: "4",
    DebitTotal: "100", DebitCurrency: "1", DebitApproveNumber: "1234567",
    ConfirmationKey: confirmationKey, ApprovedBy: "1", DebitType: "1",
  },
});
const expected = { id, amountMinor: 100, confirmationKey, transactionId };

describe("Pelecard TEST boundary", () => {
  test.each([undefined, "", "disabled", "live", "production", "TEST", " test "])(
    "rejects mode %s without reading any credential", (mode) => {
      const read = vi.fn((key: string) => key === "PELECARD_MODE" ? mode : "should-not-be-read");
      expect(() => readPelecardTestConfig(read)).toThrow("capability_disabled");
      expect(read.mock.calls).toEqual([["PELECARD_MODE"]]);
    },
  );
  test("selects only the three TEST names", () => {
    const read = vi.fn((key: string) => env[key]);
    readPelecardTestConfig(read);
    expect(read.mock.calls.map(([key]) => key)).toEqual([
      "PELECARD_MODE", "PELECARD_TEST_USER", "PELECARD_TEST_PASSWORD", "PELECARD_TEST_TERMINAL",
    ]);
  });
  test.each(["PELECARD_TEST_USER", "PELECARD_TEST_PASSWORD", "PELECARD_TEST_TERMINAL"])(
    "missing %s never falls back", (missing) => {
      const read = vi.fn((key: string) => key === missing ? undefined : env[key]);
      expect(() => readPelecardTestConfig(read)).toThrow("invalid_configuration");
      expect(read.mock.calls.some(([key]) => /^PELECARD_(USER|PASSWORD|TERMINAL)$/.test(key))).toBe(false);
    },
  );
  test("commercial execution is unconditionally disabled", () => {
    expect(() => assertCommercialPaymentsDisabled()).toThrow("capability_disabled");
  });
});

describe("documented TEST provider contract", () => {
  test("pins each endpoint to its own official contract without host substitution", () => {
    expect(PELECARD_TEST_ENDPOINTS).toEqual({
      init: "https://gateway20.pelecard.biz/PaymentGW/init",
      lookup: "https://gateway21.pelecard.biz/PaymentGW/GetTransaction",
      validate: "https://gateway21.pelecard.biz/PaymentGW/ValidateByUniqueKey",
      preflight: "https://gateway21.pelecard.biz/services/GetTerminalName",
    });
  });
  test("preflight requests only terminal-name metadata and returns no provider data", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      StatusCode: "000", ResultData: { Result: "PRIVATE TERMINAL NAME" },
    })));
    const result = await createPelecardTestProvider(config(), fetcher).preflight();
    expect(result).toEqual({ authenticated: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(PELECARD_TEST_ENDPOINTS.preflight);
    const options = fetcher.mock.calls[0][1];
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body)).toEqual({ terminalNumber: env.PELECARD_TEST_TERMINAL, user: env.PELECARD_TEST_USER, password: env.PELECARD_TEST_PASSWORD });
  });
  test("authoritative retrieval plus confirmation verifies a TEST debit", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(evidence())))
      .mockResolvedValueOnce(new Response("1"));
    const result = await createPelecardTestProvider(config(), fetcher).verify(expected);
    expect(result).toEqual({ status: "test_verified", transactionId, apiStatus: "000", transactionStatus: "000" });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([PELECARD_TEST_ENDPOINTS.lookup, PELECARD_TEST_ENDPOINTS.validate]);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ ConfirmationKey: confirmationKey, UniqueKey: id, TotalX100: "100" });
    expect(JSON.stringify(result)).not.toContain(confirmationKey);
  });
  test("accepts the documented opaque provider transaction ID without UUID coercion", async () => {
    const opaque = "1a111c-1d1f6g-9h8j";
    const body = evidence(); body.ResultData.TransactionId = opaque;
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body))).mockResolvedValueOnce(new Response("1"));
    await expect(createPelecardTestProvider(config(), fetcher).verify({ ...expected, transactionId: opaque })).resolves.toMatchObject({ transactionId: opaque });
  });
  test.each(["00", "0", 0, "000 ", undefined])("never normalizes API status %s", async (code) => {
    const body = { ...evidence(), StatusCode: code };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(createPelecardTestProvider(config(), fetcher).verify(expected)).rejects.toThrow("invalid_provider_response");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test.each(["00", "0", 0, "000 ", undefined, "004"])("API success cannot override transaction status %s", async (code) => {
    const body = evidence();
    (body.ResultData as Record<string, unknown>).ShvaResult = code;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(createPelecardTestProvider(config(), fetcher).verify(expected)).rejects.toThrow("invalid_provider_response");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test.each([
    ["TransactionId", "other-id"], ["DebitTotal", "101"], ["DebitCurrency", "2"],
    ["ConfirmationKey", "forged"], ["JParam", "5"], ["ApprovedBy", "0"],
    ["DebitType", "51"], ["DebitApproveNumber", ""], ["ShvaResultEmv", "004"],
  ])("rejects inconsistent %s", async (field, value) => {
    const body = evidence();
    (body.ResultData as Record<string, unknown>)[field] = value;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(createPelecardTestProvider(config(), fetcher).verify(expected)).rejects.toThrow();
  });
  test.each(["0", "true", '"1"', '{"StatusCode":"000"}'])("rejects invalid confirmation result %s", async (validation) => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(evidence())))
      .mockResolvedValueOnce(new Response(validation));
    await expect(createPelecardTestProvider(config(), fetcher).verify(expected)).rejects.toThrow("forged_callback");
  });
  test("does not leak transport/provider errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(env.PELECARD_TEST_PASSWORD));
    await expect(createPelecardTestProvider(config(), fetcher).preflight()).rejects.toThrow(/^provider_unavailable$/);
  });
  test("initialization sends only hosted TEST fields and omits invoices/card data", async () => {
    const url = `https://gateway20.pelecard.biz/PaymentGW/Payment?transactionId=${transactionId}`;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ URL: url, ConfirmationKey: confirmationKey })));
    const provider = createPelecardTestProvider(config(), fetcher);
    const result = await provider.initiate({ id, amountMinor: 100, feedbackUrl: "https://project.supabase.co/functions/v1/pelecard-test-feedback" });
    expect(result).toEqual({ redirectUrl: url, confirmationKey });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(["terminal", "user", "password", "ActionType", "Currency", "Total", "UserKey", "GoodURL", "ErrorURL", "CancelURL", "ServerSideGoodFeedbackURL", "ServerSideErrorFeedbackURL", "resultDataKeyName"].sort());
    expect(body.ActionType).toBe("J4");
    expect(body.Total).toBe("100");
    expect(body.UserKey).toBe(id);
  });
  test.each(["http://gateway20.pelecard.biz/pay", "https://gateway21.pelecard.biz/pay", "https://evil.test/pay", "https://user:pass@gateway20.pelecard.biz/pay"])("rejects redirect %s", async (url) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ URL: url, ConfirmationKey: confirmationKey })));
    await expect(createPelecardTestProvider(config(), fetcher).initiate({ id, amountMinor: 100, feedbackUrl: "https://project.supabase.co/functions/v1/pelecard-test-feedback" })).rejects.toThrow("invalid_provider_response");
  });
  test("rejects initialization API failure even when a URL is supplied", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ StatusCode: "004", URL: "https://gateway20.pelecard.biz/PaymentGW/test", ConfirmationKey: confirmationKey })));
    await expect(createPelecardTestProvider(config(), fetcher).initiate({ id, amountMinor: 100, feedbackUrl: "https://project.supabase.co/functions/v1/pelecard-test-feedback" })).rejects.toThrow("invalid_provider_response");
  });
});
