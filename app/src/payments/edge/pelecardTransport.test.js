import { describe, expect, test, vi } from "vitest";
import { createPelecardTransport, lazyPelecardTransport, decodePelecardNotification, verificationAdapter } from "../../../../supabase/functions/_shared/pelecard-transport.ts";
import { createPelecardCallbackHandler } from "../../../../supabase/functions/_shared/payment-handlers.ts";

const paymentId = "9a79f940-dc0b-435a-8b1f-b69823933b83";
const transactionId = "b320ab1b-cb19-4411-87d5-d793c4b61297";
const env = { PELECARD_USER: "fixture-user", PELECARD_PASSWORD: "fixture-secret", PELECARD_TERMINAL: "fixture-terminal", PELECARD_BASE_URL: "https://gateway20.pelecard.biz" };
const response = (body) => new Response(JSON.stringify(body));
const input = { amountMinor: 100, currencyCode: "ILS", merchantKey: paymentId, returnUrl: "https://app.example.test/payment/return", callbackUrl: "https://edge.example.test/callback" };
const lookup = { localPaymentId: paymentId, merchantCorrelation: paymentId, terminalReference: env.PELECARD_TERMINAL, providerTransactionId: transactionId };
const wire = { StatusCode: "000", ShvaResult: "000", TransactionId: transactionId, ConfirmationKey: "fixture-confirmation", DebitApproveNumber: "12345", DebitTotal: "100", DebitCurrency: "1" };

describe("documented Pelecard HTTP adapter", () => {
  test("defers missing provider configuration until readiness check so auth and OPTIONS still work", () => {
    const provider = lazyPelecardTransport({});
    expect(() => provider.assertReady()).toThrow("invalid_configuration");
  });
  test("requires explicit endpoint before any network request", () => {
    expect(() => createPelecardTransport({ ...env, PELECARD_BASE_URL: undefined })).toThrow("invalid_configuration");
    expect(() => createPelecardTransport({ ...env, PELECARD_BASE_URL: "https://attacker.test" })).toThrow("invalid_configuration");
  });
  test("initializes a fixed amount with server credentials and correlated feedback URLs", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ URL: `https://gateway20.pelecard.biz/PaymentGW/?id=${transactionId}` }));
    const provider = createPelecardTransport(env, fetcher);
    const result = await provider.initiate(input);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(`${env.PELECARD_BASE_URL}/PaymentGW/init`);
    const payload = JSON.parse(options.body);
    expect(payload).toMatchObject({ terminal: env.PELECARD_TERMINAL, user: env.PELECARD_USER, password: env.PELECARD_PASSWORD, Total: "100", Currency: "1", UserKey: paymentId, FreeTotal: "False", CreateToken: "False", ActionType: "J4", resultDataKeyName: "result" });
    expect(new URL(payload.ServerSideGoodFeedbackURL).searchParams.get("paymentId")).toBe(paymentId);
    expect(result).toEqual({ redirectUrl: `https://gateway20.pelecard.biz/PaymentGW/?id=${transactionId}`, sessionReference: `https://gateway20.pelecard.biz/PaymentGW/?id=${transactionId}` });
    expect(JSON.stringify(result)).not.toContain(env.PELECARD_PASSWORD);
  });
  test.each([{}, { URL: "https://attacker.test" }, { StatusCode: "999" }])("rejects malformed or failed initialization", async (body) => {
    const provider = createPelecardTransport(env, vi.fn().mockResolvedValue(response(body)));
    await expect(provider.initiate(input)).rejects.toThrow("invalid_provider_response");
  });
  test("looks up the transaction and validates the lookup's own confirmation key", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ ...wire, CreditCardNumber: "discard", Token: "discard" })).mockResolvedValueOnce(response(1));
    const result = await createPelecardTransport(env, fetcher).lookup(lookup);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).TransactionId).toBe(transactionId);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ ConfirmationKey: wire.ConfirmationKey, UniqueKey: paymentId, TotalX100: "100" });
    expect(result).toEqual({ providerTransactionId: transactionId, approvalId: "12345", statusCode: "000", amountMinor: 100, currencyCode: "ILS", terminalNumber: env.PELECARD_TERMINAL, merchantKey: paymentId });
  });
  test("cannot reuse another order's transaction", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(wire)).mockResolvedValueOnce(response(0));
    await expect(createPelecardTransport(env, fetcher).lookup(lookup)).rejects.toThrow("forged_callback");
  });
  test("rejects transaction mismatch", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ ...wire, TransactionId: paymentId }));
    await expect(createPelecardTransport(env, fetcher).lookup(lookup)).rejects.toThrow("provider_mismatch");
  });
  test.each(["004", "009", "500", "unknown"])("never treats lookup operation success as payment success (%s)", async (status) => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ ...wire, ShvaResult: status })).mockResolvedValueOnce(response(1));
    expect((await createPelecardTransport(env, fetcher).lookup(lookup)).statusCode).toBe(status);
  });
  test.each([new DOMException("fixture", "TimeoutError"), new Error("fixture")])("sanitizes network failures", async (error) => {
    const provider = createPelecardTransport(env, vi.fn().mockRejectedValue(error));
    await expect(provider.initiate(input)).rejects.toMatchObject({ code: error.name === "TimeoutError" ? "provider_timeout" : "provider_unavailable" });
  });
  test("decodes form-wrapped callbacks and browser returns without trusting status", () => {
    const notice = { ConfirmationKey: "fixture-confirmation", PelecardTransactionId: transactionId, PelecardStatusCode: "000" };
    const expected = { paymentId, uniqueKey: paymentId, confirmationKey: "fixture-confirmation", providerTransactionId: transactionId };
    expect(decodePelecardNotification({ contentType: "application/x-www-form-urlencoded", body: { result: JSON.stringify(notice) }, paymentIdHint: paymentId })).toEqual(expected);
    expect(decodePelecardNotification({ contentType: "application/json", body: { paymentId, notification: notice } })).toEqual(expected);
    expect(() => decodePelecardNotification({ contentType: "application/json", body: { paymentId, notification: { PelecardStatusCode: "000" } } })).toThrow();
  });
  test.each([
    [100, "000", 200, "succeeded"],
    [200, "000", 409, "pending_provider"],
    [100, "004", 202, "pending_provider"],
    [100, "009", 202, "pending_provider"],
    [100, "500", 202, "pending_provider"],
  ])("reconciles real wire shapes and replay safely (amount %s/status %s)", async (amountMinor, statusCode, httpStatus, finalStatus) => {
    let payment = { id: paymentId, amountMinor, currencyCode: "ILS", status: "pending_provider" };
    const store = {
      getPayment: vi.fn(async () => payment),
      finalize: vi.fn(async () => (payment = { ...payment, status: "succeeded", saleId: "one-sale" })),
      markFailed: vi.fn(), recordRejected: vi.fn(),
    };
    const fetcher = vi.fn(async url => url.endsWith("GetTransaction") ? response({ ...wire, ShvaResult: statusCode }) : response(1));
    const handler = createPelecardCallbackHandler({ store, provider: verificationAdapter(createPelecardTransport(env, fetcher)), decodeNotification: decodePelecardNotification, config: { allowedAppOrigins: ["https://app.example.test"], maxBodyBytes: 32768, terminalReference: env.PELECARD_TERMINAL, successfulProviderStatusCodes: ["000"], failedProviderStatusCodes: [] } });
    const request = () => new Request(`https://edge.example.test/callback?paymentId=${paymentId}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ result: JSON.stringify({ ConfirmationKey: "fixture-confirmation", PelecardTransactionId: transactionId, PelecardStatusCode: "000" }) }) });
    expect((await handler(request())).status).toBe(httpStatus);
    expect(payment.status).toBe(finalStatus);
    await handler(request());
    expect(store.finalize).toHaveBeenCalledTimes(finalStatus === "succeeded" ? 1 : 0);
    expect(store.markFailed).not.toHaveBeenCalled();
  });
});
