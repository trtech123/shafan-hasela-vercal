import type { OrderSource } from "../rivhit/types.ts";
import type {
  AccountingEventClaim,
  AccountingEventFailure,
  AccountingEventFence,
  AccountingEventStatus,
  VerifiedPaymentCheckoutItem,
  VerifiedPelecardPaymentSource,
} from "./types.ts";

interface SupabaseResult {
  data?: unknown;
  error?: { message?: string } | null;
}

interface SupabaseQuery {
  eq(column: string, value: unknown): SupabaseQuery;
  maybeSingle(): PromiseLike<SupabaseResult>;
}

interface SupabaseClientLike {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<SupabaseResult>;
  from(table: string): {
    select(columns: string): SupabaseQuery;
  };
}

type UnknownRecord = Record<string, unknown>;

const EVENT_STATUSES = new Set<AccountingEventStatus>([
  "pending",
  "processing",
  "succeeded",
  "retryable_error",
  "permanent_error",
  "reconciliation_required",
  "configuration_required",
]);

export type PaymentAccountingRepositoryErrorCode =
  | "database_error"
  | "malformed_response"
  | "stale_event_fence";

export class PaymentAccountingRepositoryError extends Error {
  readonly code: PaymentAccountingRepositoryErrorCode;

  constructor(code: PaymentAccountingRepositoryErrorCode, operation: string) {
    super(`${operation}: ${code}`);
    this.name = "PaymentAccountingRepositoryError";
    this.code = code;
  }
}

export type PaymentAccountingSourceStateCode =
  | "source_not_found"
  | "wrong_provider"
  | "wrong_operation"
  | "payment_not_succeeded"
  | "payment_not_verified"
  | "missing_provider_transaction"
  | "missing_sale"
  | "malformed_amount"
  | "malformed_currency"
  | "malformed_checkout"
  | "missing_linked_order"
  | "malformed_linked_order"
  | "malformed_activity";

export class PaymentAccountingSourceStateError extends Error {
  readonly code: PaymentAccountingSourceStateCode;
  readonly status: "permanent_error" | "reconciliation_required";

  constructor(
    code: PaymentAccountingSourceStateCode,
    status: PaymentAccountingSourceStateError["status"] = "reconciliation_required",
  ) {
    super(code);
    this.name = "PaymentAccountingSourceStateError";
    this.code = code;
    this.status = status;
  }
}

export interface PaymentAccountingEventRepository {
  claimEvent(
    eventId: string,
    workerId: string,
    leaseSeconds: number,
    forceRetry: boolean,
  ): Promise<AccountingEventClaim>;
  completeEvent(fence: AccountingEventFence): Promise<void>;
  failEvent(
    fence: AccountingEventFence,
    failure: AccountingEventFailure,
  ): Promise<void>;
  findEventIdForPayment(paymentId: string): Promise<string | null>;
  loadVerifiedPelecardPayment(
    sourceId: string,
  ): Promise<VerifiedPelecardPaymentSource>;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !value) return undefined;
  return value;
}

function requiredString(row: UnknownRecord, field: string): string | null {
  const value = nullableString(row[field]);
  return value === undefined || value === null ? null : value;
}

function nullableRecord(value: unknown): UnknownRecord | null | undefined {
  if (value === null) return null;
  return isRecord(value) ? value : undefined;
}

function sourceError(
  code: PaymentAccountingSourceStateCode,
  status?: PaymentAccountingSourceStateError["status"],
): never {
  throw new PaymentAccountingSourceStateError(code, status);
}

function parseMinorAmount(value: unknown): number | null {
  let decimal: string;
  if (typeof value === "string") {
    decimal = value;
  } else if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    decimal = value.toFixed(2);
    if (Number(decimal) !== value) return null;
  } else {
    return null;
  }

  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(decimal);
  if (!match) return null;
  const minor = BigInt(match[1]) * 100n
    + BigInt((match[2] || "").padEnd(2, "0"));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function checkoutItems(value: unknown): VerifiedPaymentCheckoutItem[] {
  const snapshot = nullableRecord(value);
  if (!snapshot || !Array.isArray(snapshot.items) || snapshot.items.length === 0) {
    return sourceError("malformed_checkout");
  }
  return snapshot.items.map((candidate) => {
    if (!isRecord(candidate)) return sourceError("malformed_checkout");
    const id = requiredString(candidate, "id");
    const name = requiredString(candidate, "name");
    const quantity = candidate.qty;
    const unitPriceMinor = parseMinorAmount(candidate.customPrice);
    if (
      !id
      || !name
      || !Number.isSafeInteger(quantity)
      || Number(quantity) <= 0
      || unitPriceMinor === null
    ) {
      return sourceError("malformed_checkout");
    }
    return {
      id,
      name,
      quantity: Number(quantity),
      unitPriceMinor,
    };
  });
}

function eventClaim(value: unknown): AccountingEventClaim {
  const row = Array.isArray(value) ? value[0] : null;
  if (!isRecord(row) || typeof row.claimed !== "boolean") {
    throw new PaymentAccountingRepositoryError("malformed_response", "claim_accounting_event");
  }
  const id = requiredString(row, "id");
  const sourceType = nullableString(row.source_type);
  const sourceId = nullableString(row.source_id);
  const purpose = nullableString(row.purpose);
  const accountingProvider = nullableString(row.accounting_provider);
  const statusValue = nullableString(row.status);
  const attemptCount = row.attempt_count === null
    ? null
    : Number.isSafeInteger(row.attempt_count) && Number(row.attempt_count) >= 0
      ? Number(row.attempt_count)
      : undefined;
  const leaseToken = nullableString(row.lease_token);
  const leaseExpiresAt = nullableString(row.lease_expires_at);
  const lastAttemptAt = nullableString(row.last_attempt_at);
  const nextAttemptAt = nullableString(row.next_attempt_at);
  const lastError = nullableRecord(row.last_error);
  const status = statusValue === null
    ? null
    : statusValue && EVENT_STATUSES.has(statusValue as AccountingEventStatus)
      ? statusValue as AccountingEventStatus
      : undefined;

  if (
    !id
    || sourceType === undefined
    || sourceId === undefined
    || purpose === undefined
    || accountingProvider === undefined
    || status === undefined
    || attemptCount === undefined
    || leaseToken === undefined
    || leaseExpiresAt === undefined
    || lastAttemptAt === undefined
    || nextAttemptAt === undefined
    || lastError === undefined
    || (row.claimed && (
      status !== "processing"
      || attemptCount === null
      || attemptCount < 1
      || !leaseToken
      || !leaseExpiresAt
    ))
  ) {
    throw new PaymentAccountingRepositoryError("malformed_response", "claim_accounting_event");
  }

  return {
    id,
    sourceType,
    sourceId,
    purpose,
    accountingProvider,
    status,
    claimed: row.claimed,
    attemptCount,
    leaseToken,
    leaseExpiresAt,
    lastAttemptAt,
    nextAttemptAt,
    lastError,
  };
}

async function rpc(
  client: SupabaseClientLike,
  operation: string,
  args: Record<string, unknown>,
): Promise<SupabaseResult> {
  try {
    const result = await client.rpc(operation, args);
    if (result.error) {
      throw new PaymentAccountingRepositoryError("database_error", operation);
    }
    return result;
  } catch (error) {
    if (error instanceof PaymentAccountingRepositoryError) throw error;
    throw new PaymentAccountingRepositoryError("database_error", operation);
  }
}

async function selectOne(
  client: SupabaseClientLike,
  table: string,
  columns: string,
  filters: ReadonlyArray<readonly [string, unknown]>,
): Promise<unknown> {
  try {
    let query = client.from(table).select(columns);
    for (const [column, value] of filters) query = query.eq(column, value);
    const result = await query.maybeSingle();
    if (result.error) {
      throw new PaymentAccountingRepositoryError("database_error", `load_${table}`);
    }
    return result.data ?? null;
  } catch (error) {
    if (error instanceof PaymentAccountingRepositoryError) throw error;
    throw new PaymentAccountingRepositoryError("database_error", `load_${table}`);
  }
}

function optionalOrderString(row: UnknownRecord, field: string): string | null {
  const value = nullableString(row[field]);
  if (value === undefined) return sourceError("malformed_linked_order");
  return value;
}

function optionalOrderNumber(row: UnknownRecord, field: string): number | string | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return sourceError("malformed_linked_order");
}

function optionalOrderInteger(row: UnknownRecord, field: string): number | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  return sourceError("malformed_linked_order");
}

function mapOrder(value: unknown, expectedId: string): {
  order: OrderSource;
  activityId: string | null;
} {
  if (!isRecord(value)) return sourceError("missing_linked_order");
  const id = requiredString(value, "id");
  const orderNumber = optionalOrderString(value, "order_number");
  const clientName = requiredString(value, "client_name");
  const clientPhone = requiredString(value, "client_phone");
  const activityId = optionalOrderString(value, "activity_id");
  if (!id || id !== expectedId || !orderNumber || !clientName || !clientPhone) {
    return sourceError("malformed_linked_order");
  }
  return {
    order: {
      id,
      order_number: orderNumber,
      client_name: clientName,
      client_phone: clientPhone,
      client_email: optionalOrderString(value, "client_email"),
      organization: optionalOrderString(value, "organization"),
      billing_institution_name: optionalOrderString(value, "billing_institution_name"),
      billing_company_id: optionalOrderString(value, "billing_company_id"),
      billing_accounting_email: optionalOrderString(value, "billing_accounting_email"),
      num_participants: optionalOrderInteger(value, "num_participants"),
      price_per_person: optionalOrderNumber(value, "price_per_person"),
      total_price: optionalOrderNumber(value, "total_price"),
    },
    activityId,
  };
}

export class SupabasePaymentAccountingRepository
  implements PaymentAccountingEventRepository {
  constructor(private readonly client: SupabaseClientLike) {}

  async claimEvent(
    eventId: string,
    workerId: string,
    leaseSeconds: number,
    forceRetry: boolean,
  ): Promise<AccountingEventClaim> {
    const result = await rpc(this.client, "claim_accounting_event", {
      p_event_id: eventId,
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
      p_force_retry: forceRetry,
    });
    return eventClaim(result.data);
  }

  async completeEvent(fence: AccountingEventFence): Promise<void> {
    const result = await rpc(this.client, "complete_accounting_event", {
      p_event_id: fence.id,
      p_attempt_count: fence.attemptCount,
      p_lease_token: fence.leaseToken,
    });
    if (result.data !== true) {
      throw new PaymentAccountingRepositoryError(
        "stale_event_fence",
        "complete_accounting_event",
      );
    }
  }

  async failEvent(
    fence: AccountingEventFence,
    failure: AccountingEventFailure,
  ): Promise<void> {
    const result = await rpc(this.client, "fail_accounting_event", {
      p_event_id: fence.id,
      p_attempt_count: fence.attemptCount,
      p_lease_token: fence.leaseToken,
      p_status: failure.status,
      p_next_attempt_at: failure.nextAttemptAt,
      p_last_error: failure.error,
    });
    if (result.data !== true) {
      throw new PaymentAccountingRepositoryError(
        "stale_event_fence",
        "fail_accounting_event",
      );
    }
  }

  async findEventIdForPayment(paymentId: string): Promise<string | null> {
    const value = await selectOne(
      this.client,
      "accounting_events",
      "id",
      [
        ["source_type", "payment_transaction"],
        ["source_id", paymentId],
        ["purpose", "payment_success"],
        ["accounting_provider", "rivhit"],
      ],
    );
    if (value === null) return null;
    if (!isRecord(value) || !requiredString(value, "id")) {
      throw new PaymentAccountingRepositoryError(
        "malformed_response",
        "load_accounting_events",
      );
    }
    return requiredString(value, "id");
  }

  async loadVerifiedPelecardPayment(
    sourceId: string,
  ): Promise<VerifiedPelecardPaymentSource> {
    const value = await selectOne(
      this.client,
      "payment_transactions",
      "id,provider,operation,order_id,sale_id,provider_transaction_id,amount,currency,status,verified_at,checkout_snapshot",
      [["id", sourceId]],
    );
    if (value === null) return sourceError("source_not_found");
    if (!isRecord(value)) return sourceError("source_not_found");
    if (value.provider !== "pelecard") {
      return sourceError("wrong_provider", "permanent_error");
    }
    if (value.operation !== "payment") {
      return sourceError("wrong_operation", "permanent_error");
    }
    if (value.status !== "succeeded") return sourceError("payment_not_succeeded");

    const id = requiredString(value, "id");
    const orderId = nullableString(value.order_id);
    const saleId = requiredString(value, "sale_id");
    const providerTransactionId = requiredString(value, "provider_transaction_id");
    const verifiedAt = requiredString(value, "verified_at");
    const currencyCode = requiredString(value, "currency");
    const amountMinor = parseMinorAmount(value.amount);
    if (!id || id !== sourceId) return sourceError("source_not_found");
    if (orderId === undefined) return sourceError("missing_linked_order");
    if (!saleId) return sourceError("missing_sale");
    if (!providerTransactionId) return sourceError("missing_provider_transaction");
    if (!verifiedAt) return sourceError("payment_not_verified");
    if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) {
      return sourceError("malformed_currency");
    }
    if (amountMinor === null || amountMinor <= 0) return sourceError("malformed_amount");
    const items = checkoutItems(value.checkout_snapshot);

    let order: OrderSource | null = null;
    let activityName: string | null = null;
    if (orderId !== null) {
      const orderValue = await selectOne(
        this.client,
        "orders",
        "id,order_number,client_name,client_phone,client_email,organization,activity_id,num_participants,price_per_person,total_price,billing_institution_name,billing_company_id,billing_accounting_email",
        [["id", orderId]],
      );
      const mapped = mapOrder(orderValue, orderId);
      order = mapped.order;
      if (mapped.activityId) {
        const activityValue = await selectOne(
          this.client,
          "activities",
          "name",
          [["id", mapped.activityId]],
        );
        if (!isRecord(activityValue) || !requiredString(activityValue, "name")) {
          return sourceError("malformed_activity");
        }
        activityName = requiredString(activityValue, "name");
      }
    }

    return {
      id,
      provider: "pelecard",
      operation: "payment",
      status: "succeeded",
      orderId,
      saleId,
      providerTransactionId,
      amountMinor,
      currencyCode,
      verifiedAt,
      checkoutItems: items,
      order,
      activityName,
    };
  }
}
