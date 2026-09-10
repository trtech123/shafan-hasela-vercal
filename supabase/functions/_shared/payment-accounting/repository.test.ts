import { describe, expect, test } from "vitest";
import {
  PaymentAccountingRepositoryError,
  PaymentAccountingSourceStateError,
  SupabasePaymentAccountingRepository,
} from "./repository.ts";

const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const paymentId = "22222222-2222-4222-8222-222222222222";
const orderId = "11111111-1111-4111-8111-111111111111";
const saleId = "33333333-3333-4333-8333-333333333333";
const leaseToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

class Query {
  readonly filters: Array<{ column: string; value: unknown }> = [];

  constructor(
    private readonly owner: RecordingSupabase,
    private readonly table: string,
    private readonly columns: string,
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  async maybeSingle() {
    this.owner.calls.push({
      kind: "select",
      table: this.table,
      columns: this.columns,
      filters: this.filters,
    });
    return this.owner.tableResults[this.table] ?? { data: null, error: null };
  }
}

class RecordingSupabase {
  calls: unknown[] = [];
  rpcResults: Record<string, { data: unknown; error: unknown }> = {};
  tableResults: Record<string, { data: unknown; error: unknown }> = {};

  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ kind: "rpc", name, args });
    return this.rpcResults[name] ?? { data: true, error: null };
  }

  from(table: string) {
    return {
      select: (columns: string) => new Query(this, table, columns),
    };
  }
}

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    source_type: "payment_transaction",
    source_id: paymentId,
    purpose: "payment_success",
    accounting_provider: "rivhit",
    status: "processing",
    claimed: true,
    attempt_count: 2,
    lease_token: leaseToken,
    lease_expires_at: "2026-09-09T10:05:00.000Z",
    last_attempt_at: "2026-09-09T10:00:00.000Z",
    next_attempt_at: null,
    last_error: null,
    ...overrides,
  };
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: paymentId,
    provider: "pelecard",
    operation: "payment",
    order_id: orderId,
    sale_id: saleId,
    provider_transaction_id: "provider-secret-not-forwarded",
    amount: "90.01",
    currency: "ILS",
    status: "succeeded",
    verified_at: "2026-09-09T10:00:00.000Z",
    checkout_snapshot: {
      schema_version: 1,
      items: [{
        id: "activity",
        name: "Rope Course",
        qty: 2,
        customPrice: 50,
        raw_provider_field: "strip-item-secret",
      }],
      discount: {
        type: "staff",
        mode: "fixed",
        value: 9.99,
        original_total: 100,
        final_total: 90.01,
      },
      raw_callback_body: "strip-callback-secret",
    },
    callback_body: "not-selected",
    ...overrides,
  };
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    order_number: "ORD-1234",
    client_name: "Private Contact",
    client_phone: "050-123-4567",
    client_email: "person@example.com",
    organization: "Client Organization",
    activity_id: "44444444-4444-4444-8444-444444444444",
    num_participants: 2,
    price_per_person: "50.00",
    total_price: "100.00",
    billing_institution_name: "Institution Billing Name",
    billing_company_id: "51-234567-8",
    billing_accounting_email: "billing@example.com",
    raw_private_field: "strip-order-secret",
    ...overrides,
  };
}

function successfulClient() {
  const client = new RecordingSupabase();
  client.tableResults.payment_transactions = { data: paymentRow(), error: null };
  client.tableResults.orders = { data: orderRow(), error: null };
  client.tableResults.activities = { data: { name: "Rope Course" }, error: null };
  return client;
}

describe("Supabase payment accounting event repository", () => {
  test("claims through migration 027 with exact lease arguments", async () => {
    const client = new RecordingSupabase();
    client.rpcResults.claim_accounting_event = {
      data: [claimedRow()],
      error: null,
    };
    const repository = new SupabasePaymentAccountingRepository(client);

    await expect(repository.claimEvent(eventId, "payment-worker-1", 180, true))
      .resolves.toEqual({
        id: eventId,
        sourceType: "payment_transaction",
        sourceId: paymentId,
        purpose: "payment_success",
        accountingProvider: "rivhit",
        status: "processing",
        claimed: true,
        attemptCount: 2,
        leaseToken,
        leaseExpiresAt: "2026-09-09T10:05:00.000Z",
        lastAttemptAt: "2026-09-09T10:00:00.000Z",
        nextAttemptAt: null,
        lastError: null,
      });
    expect(client.calls).toEqual([{
      kind: "rpc",
      name: "claim_accounting_event",
      args: {
        p_event_id: eventId,
        p_worker_id: "payment-worker-1",
        p_lease_seconds: 180,
        p_force_retry: true,
      },
    }]);
  });

  test.each([
    ["succeeded", 2, null],
    ["retryable_error", 3, "2026-09-09T10:10:00.000Z"],
  ])("preserves an unclaimed duplicate in %s state", async (status, attemptCount, nextAttemptAt) => {
    const client = new RecordingSupabase();
    client.rpcResults.claim_accounting_event = {
      data: [claimedRow({
        claimed: false,
        status,
        attempt_count: attemptCount,
        lease_token: null,
        lease_expires_at: null,
        next_attempt_at: nextAttemptAt,
      })],
      error: null,
    };

    const result = await new SupabasePaymentAccountingRepository(client)
      .claimEvent(eventId, "worker", 300, false);

    expect(result).toMatchObject({
      claimed: false,
      status,
      attemptCount,
      nextAttemptAt,
    });
  });

  test("preserves the migration's not-found unclaimed row", async () => {
    const client = new RecordingSupabase();
    client.rpcResults.claim_accounting_event = {
      data: [claimedRow({
        source_type: null,
        source_id: null,
        purpose: null,
        accounting_provider: null,
        status: null,
        claimed: false,
        attempt_count: null,
        lease_token: null,
        lease_expires_at: null,
        last_attempt_at: null,
      })],
      error: null,
    };

    await expect(new SupabasePaymentAccountingRepository(client)
      .claimEvent(eventId, "worker", 300, false)).resolves.toMatchObject({
        id: eventId,
        claimed: false,
        status: null,
        sourceId: null,
        attemptCount: null,
      });
  });

  test("finalizes success and failure with exact attempt and lease fencing", async () => {
    const client = new RecordingSupabase();
    const repository = new SupabasePaymentAccountingRepository(client);
    const claim = {
      id: eventId,
      attemptCount: 2,
      leaseToken,
    };

    await repository.completeEvent(claim);
    await repository.failEvent(claim, {
      status: "retryable_error",
      nextAttemptAt: "2026-09-09T10:01:00.000Z",
      error: { code: "rivhit_unavailable", message: "Rivhit unavailable" },
    });

    expect(client.calls).toEqual([
      {
        kind: "rpc",
        name: "complete_accounting_event",
        args: {
          p_event_id: eventId,
          p_attempt_count: 2,
          p_lease_token: leaseToken,
        },
      },
      {
        kind: "rpc",
        name: "fail_accounting_event",
        args: {
          p_event_id: eventId,
          p_attempt_count: 2,
          p_lease_token: leaseToken,
          p_status: "retryable_error",
          p_next_attempt_at: "2026-09-09T10:01:00.000Z",
          p_last_error: { code: "rivhit_unavailable", message: "Rivhit unavailable" },
        },
      },
    ]);
  });

  test.each(["rpc_error", "stale_fence"])("rejects unsafe finalization: %s", async (kind) => {
    const client = new RecordingSupabase();
    client.rpcResults.complete_accounting_event = kind === "rpc_error"
      ? { data: null, error: { message: "database unavailable" } }
      : { data: false, error: null };
    const repository = new SupabasePaymentAccountingRepository(client);

    await expect(repository.completeEvent({ id: eventId, attemptCount: 2, leaseToken }))
      .rejects.toBeInstanceOf(PaymentAccountingRepositoryError);
  });

  test("loads only durable verified payment, checkout, order and activity fields", async () => {
    const client = successfulClient();
    const repository = new SupabasePaymentAccountingRepository(client);

    const source = await repository.loadVerifiedPelecardPayment(paymentId);

    expect(source).toEqual({
      id: paymentId,
      provider: "pelecard",
      operation: "payment",
      status: "succeeded",
      orderId,
      saleId,
      providerTransactionId: "provider-secret-not-forwarded",
      amountMinor: 9001,
      currencyCode: "ILS",
      verifiedAt: "2026-09-09T10:00:00.000Z",
      checkoutItems: [{
        id: "activity",
        name: "Rope Course",
        quantity: 2,
        unitPriceMinor: 5000,
      }],
      order: {
        id: orderId,
        order_number: "ORD-1234",
        client_name: "Private Contact",
        client_phone: "050-123-4567",
        client_email: "person@example.com",
        organization: "Client Organization",
        num_participants: 2,
        price_per_person: "50.00",
        total_price: "100.00",
        billing_institution_name: "Institution Billing Name",
        billing_company_id: "51-234567-8",
        billing_accounting_email: "billing@example.com",
      },
      activityName: "Rope Course",
    });
    expect(JSON.stringify(source)).not.toContain("strip-item-secret");
    expect(JSON.stringify(source)).not.toContain("strip-callback-secret");
    expect(JSON.stringify(source)).not.toContain("strip-order-secret");
    const paymentSelect = client.calls.find((call) =>
      (call as { table?: string }).table === "payment_transactions"
    ) as { columns: string };
    expect(paymentSelect.columns).not.toContain("callback");
    expect(paymentSelect.columns).not.toContain("provider_status_code");
  });

  test("represents a verified payment with nullable order linkage without querying orders", async () => {
    const client = successfulClient();
    client.tableResults.payment_transactions = {
      data: paymentRow({ order_id: null }),
      error: null,
    };
    const source = await new SupabasePaymentAccountingRepository(client)
      .loadVerifiedPelecardPayment(paymentId);

    expect(source).toMatchObject({ orderId: null, order: null, activityName: null });
    expect(client.calls).not.toContainEqual(expect.objectContaining({
      kind: "select",
      table: "orders",
    }));
  });

  test("rejects a malformed linked order instead of casting it into a trusted shape", async () => {
    const client = successfulClient();
    client.tableResults.orders = {
      data: orderRow({ num_participants: "2" }),
      error: null,
    };

    await expect(new SupabasePaymentAccountingRepository(client)
      .loadVerifiedPelecardPayment(paymentId)).rejects.toMatchObject({
        name: "PaymentAccountingSourceStateError",
        code: "malformed_linked_order",
      } satisfies Partial<PaymentAccountingSourceStateError>);
  });

  test.each([
    ["source_not_found", null],
    ["wrong_provider", paymentRow({ provider: "icredit" })],
    ["wrong_operation", paymentRow({ operation: "refund" })],
    ["payment_not_succeeded", paymentRow({ status: "pending_provider" })],
    ["payment_not_verified", paymentRow({ verified_at: null })],
    ["missing_provider_transaction", paymentRow({ provider_transaction_id: null })],
    ["missing_sale", paymentRow({ sale_id: null })],
    ["malformed_amount", paymentRow({ amount: "90.001" })],
  ])("rejects an invalid durable source: %s", async (code, row) => {
    const client = successfulClient();
    client.tableResults.payment_transactions = { data: row, error: null };

    await expect(new SupabasePaymentAccountingRepository(client)
      .loadVerifiedPelecardPayment(paymentId)).rejects.toMatchObject({
        name: "PaymentAccountingSourceStateError",
        code,
      } satisfies Partial<PaymentAccountingSourceStateError>);
  });

  test("distinguishes database load failures from invalid financial state", async () => {
    const client = successfulClient();
    client.tableResults.payment_transactions = {
      data: null,
      error: { message: "connection reset" },
    };

    await expect(new SupabasePaymentAccountingRepository(client)
      .loadVerifiedPelecardPayment(paymentId)).rejects.toMatchObject({
        name: "PaymentAccountingRepositoryError",
        code: "database_error",
      } satisfies Partial<PaymentAccountingRepositoryError>);
  });

  test("finds the event for local payment identity using only durable keys", async () => {
    const client = new RecordingSupabase();
    client.tableResults.accounting_events = { data: { id: eventId }, error: null };

    await expect(new SupabasePaymentAccountingRepository(client)
      .findEventIdForPayment(paymentId)).resolves.toBe(eventId);
    expect(client.calls).toEqual([{
      kind: "select",
      table: "accounting_events",
      columns: "id",
      filters: [
        { column: "source_type", value: "payment_transaction" },
        { column: "source_id", value: paymentId },
        { column: "purpose", value: "payment_success" },
        { column: "accounting_provider", value: "rivhit" },
      ],
    }]);
  });
});
