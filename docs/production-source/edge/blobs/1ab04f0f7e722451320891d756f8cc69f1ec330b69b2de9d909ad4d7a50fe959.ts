import {
  authorizeStaff,
  type PaymentAuthenticator,
} from "./payment-auth.ts";
import {
  parsePaymentJson,
  paymentCorsHeaders,
  PaymentHttpError,
  paymentJson,
} from "./payment-http.ts";
import type { PaymentStore, ReservedPayment } from "./payment-store.ts";
import {
  type HostedPaymentSession,
  type InitiateProviderPayment,
  PaymentError,
} from "./payment-types.ts";

type UnknownRecord = Record<string, unknown>;

export interface InitiationProvider {
  assertReady?(): void;
  initiate(input: InitiateProviderPayment): Promise<HostedPaymentSession>;
}

export interface PelecardInitiationConfig {
  allowedAppOrigins: readonly string[];
  allowedProviderRedirectOrigins: readonly string[];
  returnUrl: string;
  callbackUrl: string;
  currencyCode: string;
  maxBodyBytes: number;
  requireOrder?: boolean;
}

export interface PelecardInitiationDependencies {
  auth: PaymentAuthenticator;
  store: PaymentStore;
  provider: InitiationProvider;
  createPaymentId: () => string;
  config: PelecardInitiationConfig;
}

interface CheckoutItem {
  id: string;
  name: string;
  qty: number;
  customPrice: number;
}

interface CheckoutDiscount {
  type: string;
  mode: "percentage" | "fixed";
  value: number;
  original_total: number;
  final_total: number;
}

interface CheckoutSnapshot {
  schema_version: 1;
  items: CheckoutItem[];
  discount: CheckoutDiscount | null;
  linked_order_info: {
    order_number: string;
    client_name: string;
    client_phone: string;
    organization: string;
  } | null;
  sale_date: string;
}

interface ValidatedInitiation {
  idempotencyKey: string;
  orderId: string | null;
  checkout: CheckoutSnapshot;
  amountMinor: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_LEDGER_AMOUNT_MINOR = 9_999_999_999;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function validString(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim() === value &&
    value.length >= min && value.length <= max;
}

function toMinor(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) < 1e-7
    ? rounded
    : null;
}

function dateIsValid(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateItems(value: unknown): { items: CheckoutItem[]; subtotalMinor: number } | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1_000) {
    return null;
  }

  let subtotalMinor = 0;
  const items: CheckoutItem[] = [];
  for (const candidate of value) {
    const qty = isRecord(candidate) ? candidate.qty : undefined;
    if (!isRecord(candidate) ||
      !hasExactKeys(candidate, ["id", "name", "qty", "customPrice"]) ||
      !validString(candidate.id, 1, 100) ||
      !validString(candidate.name, 1, 200) ||
      typeof qty !== "number" || !Number.isSafeInteger(qty) || qty <= 0 ||
      qty > 10_000) {
      return null;
    }
    const priceMinor = toMinor(candidate.customPrice);
    if (priceMinor === null || priceMinor > MAX_LEDGER_AMOUNT_MINOR) return null;
    const lineTotal = priceMinor * qty;
    if (!Number.isSafeInteger(lineTotal)) return null;
    subtotalMinor += lineTotal;
    if (!Number.isSafeInteger(subtotalMinor) ||
      subtotalMinor > MAX_LEDGER_AMOUNT_MINOR) return null;
    items.push({
      id: candidate.id,
      name: candidate.name,
      qty,
      customPrice: candidate.customPrice as number,
    });
  }
  return { items, subtotalMinor };
}

function validateDiscount(
  value: unknown,
  subtotalMinor: number,
): { discount: CheckoutDiscount | null; finalMinor: number } | null {
  if (value === null) return { discount: null, finalMinor: subtotalMinor };
  if (!isRecord(value) || !hasExactKeys(value, [
    "type", "mode", "value", "original_total", "final_total",
  ]) || !validString(value.type, 1, 100) ||
    (value.mode !== "percentage" && value.mode !== "fixed")) {
    return null;
  }

  const originalMinor = toMinor(value.original_total);
  const declaredFinalMinor = toMinor(value.final_total);
  if (originalMinor !== subtotalMinor || declaredFinalMinor === null) return null;

  let discountMinor: number;
  if (value.mode === "fixed") {
    const fixedMinor = toMinor(value.value);
    if (fixedMinor === null || fixedMinor > subtotalMinor) return null;
    discountMinor = fixedMinor;
  } else {
    const percentageBasisPoints = toMinor(value.value);
    if (percentageBasisPoints === null || percentageBasisPoints > 10_000) return null;
    discountMinor = Math.round(
      (subtotalMinor * percentageBasisPoints) / 10_000,
    );
  }

  const finalMinor = subtotalMinor - discountMinor;
  if (declaredFinalMinor !== finalMinor) return null;
  return {
    discount: value as unknown as CheckoutDiscount,
    finalMinor,
  };
}

function validateLinkedOrder(value: unknown): CheckoutSnapshot["linked_order_info"] | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, [
    "order_number", "client_name", "client_phone", "organization",
  ]) || !validString(value.order_number, 1, 100) ||
    !validString(value.client_name, 1, 200) ||
    !validString(value.client_phone, 0, 30) ||
    !validString(value.organization, 0, 200)) {
    return undefined;
  }
  return value as unknown as NonNullable<CheckoutSnapshot["linked_order_info"]>;
}

export function validatePelecardInitiation(value: unknown): ValidatedInitiation {
  if (!isRecord(value) ||
    !Object.keys(value).every((key) =>
      ["idempotencyKey", "orderId", "checkout"].includes(key)
    ) || !("idempotencyKey" in value) || !("checkout" in value) ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_PATTERN.test(value.idempotencyKey) ||
    (value.orderId !== undefined && value.orderId !== null &&
      (typeof value.orderId !== "string" || !UUID_PATTERN.test(value.orderId))) ||
    !isRecord(value.checkout) || !hasExactKeys(value.checkout, [
      "schema_version", "items", "discount", "linked_order_info", "sale_date",
    ]) || value.checkout.schema_version !== 1 ||
    !dateIsValid(value.checkout.sale_date)) {
    throw new PaymentHttpError(400, "invalid_input");
  }

  const itemResult = validateItems(value.checkout.items);
  const linkedOrder = validateLinkedOrder(value.checkout.linked_order_info);
  if (!itemResult || linkedOrder === undefined) {
    throw new PaymentHttpError(400, "invalid_input");
  }
  const discountResult = validateDiscount(
    value.checkout.discount,
    itemResult.subtotalMinor,
  );
  if (!discountResult || discountResult.finalMinor <= 0) {
    throw new PaymentHttpError(400, "invalid_input");
  }

  return {
    idempotencyKey: value.idempotencyKey,
    orderId: (value.orderId ?? null) as string | null,
    checkout: {
      schema_version: 1,
      items: itemResult.items,
      discount: discountResult.discount,
      linked_order_info: linkedOrder,
      sale_date: value.checkout.sale_date,
    },
    amountMinor: discountResult.finalMinor,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function identityMatches(
  existing: ReservedPayment,
  requested: ValidatedInitiation,
  creatorId: string,
  currencyCode: string,
): boolean {
  return existing.provider === "pelecard" &&
    existing.orderId === requested.orderId &&
    existing.createdBy === creatorId &&
    existing.idempotencyKey === requested.idempotencyKey &&
    existing.amountMinor === requested.amountMinor &&
    existing.currencyCode === currencyCode &&
    (requested.orderId !== null ||
      stableJson(existing.checkoutSnapshot) === stableJson(requested.checkout));
}

function configuredUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function validHostedSession(
  session: HostedPaymentSession,
  allowedOrigins: readonly string[],
): boolean {
  if (!session || typeof session.redirectUrl !== "string" ||
    typeof session.sessionReference !== "string" ||
    session.sessionReference.length === 0 || session.sessionReference.length > 200) {
    return false;
  }
  try {
    const url = new URL(session.redirectUrl);
    return url.protocol === "https:" && !url.username && !url.password &&
      allowedOrigins.includes(url.origin);
  } catch {
    return false;
  }
}

function existingResponse(
  payment: ReservedPayment,
  allowedRedirectOrigins: readonly string[],
  cors: HeadersInit,
): Response {
  if (payment.status === "pending_provider" && payment.redirectUrl &&
    payment.providerSessionId && validHostedSession({
      redirectUrl: payment.redirectUrl,
      sessionReference: payment.providerSessionId,
    }, allowedRedirectOrigins)) {
    return paymentJson({
      paymentId: payment.id,
      status: "pending_provider",
      redirectUrl: payment.redirectUrl,
    }, 200, cors);
  }
  return paymentJson({ paymentId: payment.id, status: payment.status }, 202, cors);
}

function providerErrorStatus(code: string): number {
  if (code === "provider_timeout") return 504;
  if (code === "provider_unavailable" || code === "capability_unconfigured") return 503;
  return 502;
}

export function createPelecardInitiateHandler(
  dependencies: PelecardInitiationDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let cors: HeadersInit = {};
    try {
      cors = paymentCorsHeaders(request, dependencies.config.allowedAppOrigins);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method !== "POST") {
        return paymentJson({ error: { code: "method_not_allowed" } }, 405, cors);
      }

      const authorization = await authorizeStaff(request, dependencies.auth);
      if (!authorization.ok) {
        return paymentJson(
          { error: { code: authorization.code } },
          authorization.status,
          cors,
        );
      }

      const body = await parsePaymentJson(request, dependencies.config.maxBodyBytes);
      const input = validatePelecardInitiation(body);
      if (dependencies.config.requireOrder && !input.orderId) {
        throw new PaymentHttpError(400, "order_required");
      }
      if (!CURRENCY_PATTERN.test(dependencies.config.currencyCode) ||
        !configuredUrl(dependencies.config.returnUrl) ||
        !configuredUrl(dependencies.config.callbackUrl)) {
        throw new PaymentHttpError(500, "invalid_configuration");
      }

      dependencies.provider.assertReady?.();
      const reservation = await dependencies.store.reserve({
        proposedPaymentId: dependencies.createPaymentId(),
        orderId: input.orderId,
        createdBy: authorization.identity.id,
        idempotencyKey: input.idempotencyKey,
        amountMinor: input.amountMinor,
        currencyCode: dependencies.config.currencyCode,
        checkoutSnapshot: input.checkout,
      });

      if (!identityMatches(
        reservation.payment,
        input,
        authorization.identity.id,
        dependencies.config.currencyCode,
      )) {
        return paymentJson({ error: { code: "idempotency_conflict" } }, 409, cors);
      }
      if (!reservation.created) {
        return existingResponse(
          reservation.payment,
          dependencies.config.allowedProviderRedirectOrigins,
          cors,
        );
      }

      try {
        const session = await dependencies.provider.initiate({
          amountMinor: reservation.payment.amountMinor,
          currencyCode: reservation.payment.currencyCode,
          merchantKey: reservation.payment.merchantCorrelation,
          returnUrl: dependencies.config.returnUrl,
          callbackUrl: dependencies.config.callbackUrl,
        });
        if (!validHostedSession(
          session,
          dependencies.config.allowedProviderRedirectOrigins,
        )) {
          throw new PaymentError("invalid_provider_response");
        }
        const payment = await dependencies.store.saveHostedSession(
          reservation.payment.id,
          session,
        );
        return paymentJson({
          paymentId: payment.id,
          status: "pending_provider",
          redirectUrl: payment.redirectUrl,
        }, 201, cors);
      } catch (error) {
        const code = error instanceof PaymentError
          ? error.code
          : "provider_unavailable";
        await dependencies.store.markInitiationUncertain(
          reservation.payment.id,
          code,
        );
        return paymentJson({
          error: { code },
          paymentId: reservation.payment.id,
        }, providerErrorStatus(code), cors);
      }
    } catch (error) {
      if (error instanceof PaymentHttpError) {
        return paymentJson({ error: { code: error.code } }, error.status, cors);
      }
      if (error instanceof PaymentError) {
        return paymentJson({ error: { code: error.code } }, providerErrorStatus(error.code), cors);
      }
      return paymentJson({ error: { code: "internal_error" } }, 500, cors);
    }
  };
}
