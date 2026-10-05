export const PELECARD_PENDING_PAYMENT_KEY = "pelecard.pendingPayment.v1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
const PAYMENT_STATUSES = new Set([
  "initiated",
  "pending_provider",
  "succeeded",
  "failed",
  "timed_out",
  "refund_pending",
  "refunded",
  "void_pending",
  "voided",
]);
const POLLING_TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "timed_out",
  "refunded",
  "voided",
]);
const MAX_LEDGER_AMOUNT_MINOR = 9_999_999_999;

function toMinor(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) <= 1e-7 && Number.isSafeInteger(rounded)
    ? rounded
    : null;
}

export function calculateCheckoutTotals(items, discount) {
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, subtotal: 0, discountAmount: 0, total: 0 };
  }
  let subtotalMinor = 0;
  for (const item of items) {
    const priceMinor = toMinor(item?.customPrice);
    if (priceMinor === null || !Number.isSafeInteger(item?.qty) || item.qty <= 0) {
      return { valid: false, subtotal: 0, discountAmount: 0, total: 0 };
    }
    subtotalMinor += priceMinor * item.qty;
    if (!Number.isSafeInteger(subtotalMinor) ||
      subtotalMinor > MAX_LEDGER_AMOUNT_MINOR) {
      return { valid: false, subtotal: 0, discountAmount: 0, total: 0 };
    }
  }

  let discountMinor = 0;
  if (discount !== null && discount !== undefined) {
    const discountValue = typeof discount.value === "string"
      ? Number(discount.value)
      : discount.value;
    const valueMinor = toMinor(discountValue);
    if (valueMinor === null) {
      return { valid: false, subtotal: 0, discountAmount: 0, total: 0 };
    }
    if (discount.mode === "percentage") {
      if (valueMinor > 10_000) {
        return { valid: false, subtotal: 0, discountAmount: 0, total: 0 };
      }
      discountMinor = Math.round((subtotalMinor * valueMinor) / 10_000);
    } else if (discount.mode === "fixed" && valueMinor <= subtotalMinor) {
      discountMinor = valueMinor;
    } else {
      return { valid: false, subtotal: 0, discountAmount: 0, total: 0 };
    }
  }

  return {
    valid: true,
    subtotal: subtotalMinor / 100,
    discountAmount: discountMinor / 100,
    total: (subtotalMinor - discountMinor) / 100,
  };
}

export class PelecardFrontendError extends Error {
  constructor(code) {
    super(code);
    this.name = "PelecardFrontendError";
    this.code = code;
  }
}

function validString(value) {
  return typeof value === "string" && value.length > 0;
}

async function invoke(client, name, body) {
  if (!client?.functions?.invoke) {
    throw new PelecardFrontendError("invalid_configuration");
  }
  let result;
  try {
    result = await client.functions.invoke(name, { body });
  } catch {
    throw new PelecardFrontendError("request_failed");
  }
  if (result?.error || !result?.data || typeof result.data !== "object") {
    throw new PelecardFrontendError("request_failed");
  }
  return result.data;
}

function normalizeAllowedOrigins(origins) {
  if (!Array.isArray(origins) || origins.length === 0) {
    throw new PelecardFrontendError("invalid_configuration");
  }
  return origins.map((origin) => {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) {
        throw new Error("invalid");
      }
      return url.origin;
    } catch {
      throw new PelecardFrontendError("invalid_configuration");
    }
  });
}

function safeHostedResult(data, allowedRedirectOrigins) {
  if (UUID_PATTERN.test(String(data.paymentId)) && PAYMENT_STATUSES.has(data.status)
    && data.status !== 'pending_provider' && data.redirectUrl === undefined) {
    return { paymentId: data.paymentId, status: data.status };
  }
  if (!UUID_PATTERN.test(String(data.paymentId)) ||
    data.status !== "pending_provider" || !validString(data.redirectUrl)) {
    throw new PelecardFrontendError("invalid_response");
  }
  let url;
  try {
    url = new URL(data.redirectUrl);
  } catch {
    throw new PelecardFrontendError("invalid_response");
  }
  const origins = normalizeAllowedOrigins(allowedRedirectOrigins);
  if (url.protocol !== "https:" || url.username || url.password ||
    !origins.includes(url.origin)) {
    throw new PelecardFrontendError("invalid_response");
  }
  return {
    paymentId: data.paymentId,
    status: "pending_provider",
    redirectUrl: url.href,
  };
}

export async function initiatePelecardPayment(input, options) {
  const data = await invoke(options?.client, "pelecard-initiate", input);
  return safeHostedResult(data, options?.allowedRedirectOrigins);
}

function readAttempt(storage) {
  try {
    const value = JSON.parse(storage?.getItem(PELECARD_PENDING_PAYMENT_KEY) ?? "null");
    if (!value || typeof value !== "object" ||
      !IDEMPOTENCY_PATTERN.test(String(value.idempotencyKey)) ||
      (value.paymentId !== undefined && !UUID_PATTERN.test(String(value.paymentId)))) {
      return null;
    }
    return {
      idempotencyKey: value.idempotencyKey,
      ...(UUID_PATTERN.test(String(value.orderId)) ? { orderId: value.orderId } : {}),
      ...(value.paymentId ? { paymentId: value.paymentId } : {}),
    };
  } catch {
    return null;
  }
}

export function getPendingPelecardAttempt(storage = window.sessionStorage) {
  return readAttempt(storage);
}

export async function beginHostedPelecardPayment(input, options) {
  const existing = readAttempt(options?.storage);
  const sameOrder = input.orderId && (!existing?.orderId || existing.orderId === input.orderId);
  let idempotencyKey = (existing && (input.orderId ? sameOrder : !existing.paymentId)
    ? existing.idempotencyKey
    : undefined) ??
    options?.createIdempotencyKey?.();
  if (!IDEMPOTENCY_PATTERN.test(String(idempotencyKey))) {
    throw new PelecardFrontendError("invalid_configuration");
  }
  options.storage.setItem(
    PELECARD_PENDING_PAYMENT_KEY,
    JSON.stringify({ idempotencyKey, ...(input.orderId ? { orderId: input.orderId } : {}) }),
  );
  let result = await initiatePelecardPayment({
    idempotencyKey,
    orderId: input.orderId ?? null,
    checkout: input.checkout,
  }, options);
  if (input.orderId && result.status === 'failed') {
    idempotencyKey = options?.createIdempotencyKey?.();
    if (!IDEMPOTENCY_PATTERN.test(String(idempotencyKey))) {
      throw new PelecardFrontendError('invalid_configuration');
    }
    options.storage.setItem(PELECARD_PENDING_PAYMENT_KEY,
      JSON.stringify({ idempotencyKey, orderId: input.orderId }));
    result = await initiatePelecardPayment({ idempotencyKey,
      orderId: input.orderId, checkout: input.checkout }, options);
  }
  options.storage.setItem(
    PELECARD_PENDING_PAYMENT_KEY,
    JSON.stringify({ idempotencyKey, paymentId: result.paymentId,
      ...(input.orderId ? { orderId: input.orderId } : {}) }),
  );
  options.location.assign(result.redirectUrl ?? '/payment/return');
  return result;
}

export async function verifyPelecardReturn(paymentId, notification, options) {
  if (!UUID_PATTERN.test(String(paymentId)) || !notification ||
    typeof notification !== "object" || Array.isArray(notification)) {
    throw new PelecardFrontendError("invalid_input");
  }
  const data = await invoke(options?.client, "pelecard-verify", {
    paymentId,
    notification,
  });
  return {
    paymentId: data.paymentId,
    saleId: data.saleId ?? null,
    status: data.status,
  };
}

function nullableString(value) {
  return value === null ? null : validString(value) ? value : undefined;
}

function safeStatus(data) {
  const orderId = nullableString(data.orderId);
  const saleId = nullableString(data.saleId);
  const failureCode = nullableString(data.failureCode);
  const receiptNumber = nullableString(data.receiptNumber);
  const verifiedAt = nullableString(data.verifiedAt);
  if (!UUID_PATTERN.test(String(data.id)) || !PAYMENT_STATUSES.has(data.status) ||
    !/^\d{1,8}\.\d{2}$/.test(String(data.amount)) ||
    !/^[A-Z]{3}$/.test(String(data.currency)) ||
    orderId === undefined || saleId === undefined || failureCode === undefined ||
    receiptNumber === undefined || verifiedAt === undefined ||
    !validString(data.createdAt) || !validString(data.updatedAt)) {
    throw new PelecardFrontendError("invalid_response");
  }
  return {
    id: data.id,
    orderId,
    saleId,
    amount: data.amount,
    currency: data.currency,
    status: data.status,
    failureCode,
    receiptNumber,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    verifiedAt,
  };
}

export async function getPelecardStatus(paymentId, options) {
  if (!UUID_PATTERN.test(String(paymentId))) {
    throw new PelecardFrontendError("invalid_input");
  }
  return safeStatus(await invoke(options?.client, "pelecard-status", { paymentId }));
}

function defaultWait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new PelecardFrontendError("cancelled"));
    }, { once: true });
  });
}

export async function pollPelecardStatus(paymentId, options) {
  const maxAttempts = options?.maxAttempts ?? 40;
  const intervalMs = options?.intervalMs ?? 1_500;
  const wait = options?.wait ?? defaultWait;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options?.signal?.aborted) throw new PelecardFrontendError("cancelled");
    const status = await getPelecardStatus(paymentId, options);
    options?.onStatus?.(status);
    if (POLLING_TERMINAL_STATUSES.has(status.status)) return status;
    if (attempt + 1 < maxAttempts) await wait(intervalMs, options?.signal);
  }
  throw new PelecardFrontendError("poll_timeout");
}
