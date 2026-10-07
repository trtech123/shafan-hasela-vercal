export type PaymentStatus =
  | "initiated"
  | "pending_provider"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "refund_pending"
  | "refunded"
  | "void_pending"
  | "voided";

export interface ReservedPayment {
  id: string;
  provider: "pelecard";
  orderId: string | null;
  createdBy: string;
  idempotencyKey: string;
  amountMinor: number;
  currencyCode: string;
  checkoutSnapshot: unknown;
  merchantCorrelation: string;
  status: PaymentStatus;
  providerSessionId?: string;
  redirectUrl?: string;
  failureCode?: string;
}

export interface ReservePaymentInput {
  proposedPaymentId: string;
  orderId: string | null;
  createdBy: string;
  idempotencyKey: string;
  amountMinor: number;
  currencyCode: string;
  checkoutSnapshot: unknown;
}

export interface PaymentStore {
  reserve(input: ReservePaymentInput): Promise<{
    created: boolean;
    payment: ReservedPayment;
  }>;
  saveHostedSession(
    paymentId: string,
    session: { sessionReference: string; redirectUrl: string },
  ): Promise<ReservedPayment>;
  markInitiationUncertain(
    paymentId: string,
    failureCode: string,
  ): Promise<ReservedPayment>;
}

interface RpcResult {
  data: unknown;
  error: unknown;
}

interface SupabaseRpcClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<RpcResult>;
}

export class PaymentStoreError extends Error {
  constructor() {
    super("storage_unavailable");
    this.name = "PaymentStoreError";
  }
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new PaymentStoreError();
  }
  return row as UnknownRecord;
}

function stringField(row: UnknownRecord, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new PaymentStoreError();
  }
  return value;
}

function nullableString(row: UnknownRecord, field: string): string | undefined {
  const value = row[field];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new PaymentStoreError();
  }
  return value;
}

function nullableStringOrNull(row: UnknownRecord, field: string): string | null {
  return nullableString(row, field) ?? null;
}

function decimalToMinor(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new PaymentStoreError();
  }
  const amount = Number(value);
  const amountMinor = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(amountMinor)) {
    throw new PaymentStoreError();
  }
  return amountMinor;
}

function mapPayment(value: unknown): ReservedPayment {
  const row = asRecord(value);
  const id = stringField(row, "id");
  const status = stringField(row, "status");
  if (!([
    "initiated",
    "pending_provider",
    "succeeded",
    "failed",
    "timed_out",
    "refund_pending",
    "refunded",
    "void_pending",
    "voided",
  ] as string[]).includes(status)) {
    throw new PaymentStoreError();
  }
  if (row.provider !== "pelecard") throw new PaymentStoreError();

  return {
    id,
    provider: "pelecard",
    orderId: row.order_id === null ? null : stringField(row, "order_id"),
    createdBy: stringField(row, "created_by"),
    idempotencyKey: stringField(row, "idempotency_key"),
    amountMinor: decimalToMinor(row.amount),
    currencyCode: stringField(row, "currency"),
    checkoutSnapshot: row.checkout_snapshot,
    merchantCorrelation: id,
    status: status as PaymentStatus,
    providerSessionId: nullableString(row, "provider_session_id"),
    redirectUrl: nullableString(row, "provider_redirect_url"),
    failureCode: nullableString(row, "failure_code"),
  };
}

async function rpc(
  client: SupabaseRpcClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<UnknownRecord> {
  let result: RpcResult;
  try {
    result = await client.rpc(name, parameters);
  } catch {
    throw new PaymentStoreError();
  }
  if (result.error) throw new PaymentStoreError();
  return asRecord(result.data);
}

async function nullableRpc(
  client: SupabaseRpcClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  let result: RpcResult;
  try {
    result = await client.rpc(name, parameters);
  } catch {
    throw new PaymentStoreError();
  }
  if (result.error) throw new PaymentStoreError();
  return result.data;
}

function amountDecimal(amountMinor: number): string {
  return `${Math.trunc(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

/**
 * Uses service-role-only RPCs added by the atomic-finalization migration.
 * No provider payload or credential is accepted by this adapter.
 */
export function createSupabasePaymentStore(
  client: SupabaseRpcClient,
): PaymentStore {
  return {
    async reserve(input) {
      const row = await rpc(client, input.orderId
        ? "reserve_pelecard_order_payment"
        : "reserve_pelecard_payment", {
        p_payment_id: input.proposedPaymentId,
        p_order_id: input.orderId,
        p_created_by: input.createdBy,
        p_idempotency_key: input.idempotencyKey,
        p_amount: amountDecimal(input.amountMinor),
        p_currency: input.currencyCode,
        p_checkout_snapshot: input.checkoutSnapshot,
      });
      if (typeof row.created !== "boolean") throw new PaymentStoreError();
      return { created: row.created, payment: mapPayment(row) };
    },

    async saveHostedSession(paymentId, session) {
      return mapPayment(await rpc(client, "complete_pelecard_initiation", {
        p_payment_id: paymentId,
        p_provider_session_id: session.sessionReference,
        p_provider_redirect_url: session.redirectUrl,
      }));
    },

    async markInitiationUncertain(paymentId, failureCode) {
      return mapPayment(await rpc(client, "mark_pelecard_initiation_uncertain", {
        p_payment_id: paymentId,
        p_failure_code: failureCode,
      }));
    },
  };
}

function mapVerificationPayment(value: unknown): PaymentRecord {
  const row = asRecord(value);
  const status = stringField(row, "status");
  if (!(status in {
    initiated: true,
    pending_provider: true,
    succeeded: true,
    failed: true,
    timed_out: true,
    refund_pending: true,
    refunded: true,
    void_pending: true,
    voided: true,
  })) {
    throw new PaymentStoreError();
  }
  return {
    id: stringField(row, "id"),
    orderId: nullableStringOrNull(row, "order_id"),
    saleId: nullableStringOrNull(row, "sale_id"),
    amountMinor: decimalToMinor(row.amount),
    currencyCode: stringField(row, "currency"),
    status: status as PaymentStatus,
    failureCode: nullableStringOrNull(row, "failure_code"),
    providerTransactionId: nullableStringOrNull(
      row,
      "provider_transaction_id",
    ),
    providerSessionReference: nullableStringOrNull(row, "provider_session_id"),
    receiptNumber: nullableStringOrNull(row, "receipt_number"),
    createdAt: stringField(row, "created_at"),
    updatedAt: stringField(row, "updated_at"),
    verifiedAt: nullableStringOrNull(row, "verified_at"),
  };
}

/** Service-role RPC adapter. It accepts and returns allowlisted fields only. */
export function createSupabasePaymentVerificationStore(
  client: SupabaseRpcClient,
): PaymentVerificationStore {
  return {
    async getPayment(paymentId) {
      const data = await nullableRpc(client, "get_pelecard_payment", {
        p_payment_id: paymentId,
      });
      return data === null ? null : mapVerificationPayment(data);
    },

    async finalize(paymentId, transaction) {
      return mapVerificationPayment(await rpc(
        client,
        "finalize_pelecard_payment",
        {
          p_payment_id: paymentId,
          p_provider_transaction_id: transaction.providerTransactionId,
          p_approval_id: transaction.approvalId,
          p_provider_status_code: transaction.statusCode,
          p_amount: amountDecimal(transaction.amountMinor),
          p_currency: transaction.currencyCode,
        },
      ));
    },

    async markFailed(paymentId, providerStatusCode) {
      return mapVerificationPayment(await rpc(
        client,
        "fail_pelecard_payment",
        {
          p_payment_id: paymentId,
          p_provider_status_code: providerStatusCode,
          p_failure_code: "provider_declined",
        },
      ));
    },

    async recordRejected(paymentId, failureCode, source) {
      await nullableRpc(client, "record_pelecard_verification_rejection", {
        p_payment_id: paymentId,
        p_failure_code: failureCode,
        p_source: source,
      });
    },
  };
}
import type {
  PaymentRecord,
  PaymentVerificationStore,
} from "./payment-handlers.ts";
