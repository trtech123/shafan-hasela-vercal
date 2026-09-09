import { describe, expect, test, vi } from "vitest";
import {
  createPaymentAccountingRuntime,
  schedulePaymentAccountingWake,
} from "./runtime.ts";

const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const paymentId = "22222222-2222-4222-8222-222222222222";

class Query {
  filters: unknown[] = [];
  constructor(private owner: FakeServiceClient, private table: string) {}
  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }
  async maybeSingle() {
    this.owner.selects.push({ table: this.table, filters: this.filters });
    return this.owner.tableResults[this.table] ?? { data: null, error: null };
  }
}

class FakeServiceClient {
  rpcCalls: unknown[] = [];
  selects: unknown[] = [];
  tableResults: Record<string, { data: unknown; error: unknown }> = {};
  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name === "claim_accounting_event") {
      return {
        data: [{
          id: eventId,
          source_type: "payment_transaction",
          source_id: paymentId,
          purpose: "payment_success",
          accounting_provider: "rivhit",
          status: "processing",
          claimed: true,
          attempt_count: 1,
          lease_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          lease_expires_at: "2026-09-09T10:05:00.000Z",
          last_attempt_at: "2026-09-09T10:00:00.000Z",
          next_attempt_at: null,
          last_error: null,
        }],
        error: null,
      };
    }
    return { data: true, error: null };
  }
  from(table: string) {
    return { select: () => new Query(this, table) };
  }
}

const validEnv = {
  RIVHIT_API_TOKEN: "server-token",
  RIVHIT_ACCOUNTING_MODE: "sandbox",
  RIVHIT_ACCOUNT_NAMESPACE: "rivhit-sandbox",
  RIVHIT_DOCUMENT_TYPE_MAP: JSON.stringify({
    payment_success: {
      document_type: 1,
      sort_code: 100,
      currency_id: 1,
      currency_code: "ILS",
      price_include_vat: true,
      send_mail: false,
      digital_signature: false,
    },
  }),
};

describe("payment accounting runtime", () => {
  test("schedules the durable wake in EdgeRuntime without awaiting it", async () => {
    let finish!: () => void;
    const wake = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const waitUntil = vi.fn();

    expect(schedulePaymentAccountingWake(wake, paymentId, waitUntil)).toBeUndefined();
    expect(wake).toHaveBeenCalledWith(paymentId);
    expect(waitUntil).toHaveBeenCalledOnce();

    finish();
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  test("swallows scheduled wake rejection when EdgeRuntime is unavailable", async () => {
    const wake = vi.fn().mockRejectedValue(new Error("database unavailable"));

    expect(schedulePaymentAccountingWake(wake, paymentId, null)).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wake).toHaveBeenCalledWith(paymentId);
  });

  test.each([
    ["missing_rivhit_api_token", { ...validEnv, RIVHIT_API_TOKEN: undefined }],
    ["invalid_accounting_mode", { ...validEnv, RIVHIT_ACCOUNTING_MODE: "test" }],
    ["missing_account_namespace", { ...validEnv, RIVHIT_ACCOUNT_NAMESPACE: "" }],
    ["invalid_document_mapping", { ...validEnv, RIVHIT_DOCUMENT_TYPE_MAP: "{" }],
    ["missing_document_mapping", {
      ...validEnv,
      RIVHIT_DOCUMENT_TYPE_MAP: JSON.stringify({
        order_confirmation: JSON.parse(validEnv.RIVHIT_DOCUMENT_TYPE_MAP).payment_success,
      }),
    }],
    ["missing_currency_code", {
      ...validEnv,
      RIVHIT_DOCUMENT_TYPE_MAP: JSON.stringify({
        payment_success: {
          ...JSON.parse(validEnv.RIVHIT_DOCUMENT_TYPE_MAP).payment_success,
          currency_code: undefined,
        },
      }),
    }],
  ])("claims and finalizes %s as configuration_required without provider construction", async (
    code,
    env,
  ) => {
    const serviceClient = new FakeServiceClient();
    const createRivhitClient = vi.fn();
    const runtime = createPaymentAccountingRuntime({
      serviceClient,
      env,
      workerId: "runtime-worker",
      createRivhitClient,
    });

    const result = await runtime.processEvent(eventId, false);

    expect(result.status).toBe("configuration_required");
    expect(createRivhitClient).not.toHaveBeenCalled();
    expect(serviceClient.rpcCalls).toContainEqual(expect.objectContaining({
      name: "claim_accounting_event",
    }));
    expect(serviceClient.rpcCalls).toContainEqual({
      name: "fail_accounting_event",
      args: expect.objectContaining({
        p_event_id: eventId,
        p_status: "configuration_required",
        p_last_error: expect.objectContaining({ code }),
      }),
    });
  });

  test("finds the durable event and wakes processing with only local identity", async () => {
    const serviceClient = new FakeServiceClient();
    serviceClient.tableResults.accounting_events = { data: { id: eventId }, error: null };
    const processEvent = vi.fn().mockResolvedValue({ status: "succeeded" });
    const createRivhitClient = vi.fn().mockReturnValue({ createDocument: vi.fn() });
    const runtime = createPaymentAccountingRuntime({
      serviceClient,
      env: validEnv,
      workerId: "runtime-worker",
      processEvent,
      createRivhitClient,
    });

    await runtime.wakePaymentAccounting(paymentId);

    expect(processEvent).toHaveBeenCalledOnce();
    expect(processEvent.mock.calls[0][0]).toMatchObject({
      eventId,
      workerId: "runtime-worker",
      forceRetry: false,
      accountNamespace: "rivhit-sandbox",
      configurationIssue: undefined,
    });
    expect(JSON.stringify(processEvent.mock.calls)).not.toContain("callback");
    expect(createRivhitClient).toHaveBeenCalledWith("server-token");
  });

  test("treats a missing durable event as a safe no-op", async () => {
    const serviceClient = new FakeServiceClient();
    serviceClient.tableResults.accounting_events = { data: null, error: null };
    const processEvent = vi.fn();
    const runtime = createPaymentAccountingRuntime({
      serviceClient,
      env: validEnv,
      workerId: "runtime-worker",
      processEvent,
      createRivhitClient: vi.fn().mockReturnValue({}),
    });

    await expect(runtime.wakePaymentAccounting(paymentId)).resolves.toBeUndefined();
    expect(processEvent).not.toHaveBeenCalled();
  });
});
