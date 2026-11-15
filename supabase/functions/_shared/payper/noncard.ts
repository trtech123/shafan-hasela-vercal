import { CREATE_PAYPER_INVOICE_URL, type GatewayCredentials } from "./provider.ts";
import { classifyDispatchedPayperOutcome, type PayperDispatchOutcome } from "./outcome.ts";

export interface NoncardSource {
  amountMinor: number;
  method: "check" | "cash";
  documentType: "invoice-receipt";
  referenceDocumentId: null;
  receiptNumber: string;
  paidDate: string;
  items: Array<{ name: string; qty: number; customPrice: number }>;
  billing: { name: string; identity: string; email: string };
  check: null | { check_number: string; bank: string; branch: string;
    account_number: string; account_holder: string; amount: string | number;
    received_date: string; due_date: string };
  discount?: unknown;
}

export function noncardCollectionEnabled(method: "cash" | "check", env: (name: string) => string | undefined) {
  return env("PAYPER_NONCARD_COLLECTION_ENABLED") === "true" &&
    env(method === "cash" ? "PAYPER_CASH_DISPATCH_ENABLED" : "PAYPER_CHECK_DISPATCH_ENABLED") === "true";
}

const clean = (value: unknown, max: number): value is string => typeof value === "string"
  && value.length > 0 && value.length <= max && value.trim() === value
  && !/[\x00-\x1f\x7f]/.test(value);
const date = (value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new Error("payper_check_date_invalid");
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
};
const minor = (value: number): number => {
  const scaled = value * 100;
  if (!Number.isFinite(scaled) || !Number.isSafeInteger(Math.round(scaled))
    || Math.abs(scaled - Math.round(scaled)) > 1e-7 || scaled <= 0)
    throw new Error("payper_amount_mismatch");
  return Math.round(scaled);
};

/** The documented non-card form: neither identifier is a card transaction. */
export function buildNoncardPayperRequest(source: NoncardSource, auth: GatewayCredentials) {
  if (!clean(auth.terminalNumber, 50) || !clean(auth.user, 100) || !clean(auth.password, 200))
    throw new Error("payper_credentials_required");
  if (!Number.isSafeInteger(source.amountMinor) || source.amountMinor <= 0 ||
    !clean(source.receiptNumber, 100) || source.documentType !== "invoice-receipt"
    || source.referenceDocumentId !== null)
    throw new Error("payper_source_incomplete");
  if (!clean(source.billing.name, 200) || !/^[0-9]{9}$/.test(source.billing.identity)
    || !clean(source.billing.email, 320) || !/^\S+@\S+\.\S+$/.test(source.billing.email))
    throw new Error("payper_billing_incomplete");
  if (!Array.isArray(source.items) || source.items.length === 0 || source.items.length > 100)
    throw new Error("payper_items_required");
  let sum = 0;
  const lines = source.items.map(item => {
    if (!clean(item.name, 200) || !Number.isSafeInteger(item.qty) || item.qty < 1)
      throw new Error("payper_items_invalid");
    const price = minor(item.customPrice);
    sum += price * item.qty;
    return { description: item.name, quantity: String(item.qty),
      price_per_unit: String(price), include_vat: "true" as const };
  });
  if (source.discount != null && sum !== source.amountMinor) {
    const description = `תשלום עבור ${source.receiptNumber}`;
    lines.splice(0, lines.length, { description, quantity: "1",
      price_per_unit: String(source.amountMinor), include_vat: "true" });
  } else if (sum !== source.amountMinor) throw new Error("payper_amount_mismatch");
  let remarks = "";
  let paidOn = source.paidDate;
  if (source.method === "check") {
    const check = source.check;
    if (!check || !/^\d{1,20}$/.test(check.check_number) || !clean(check.bank, 100)
      || !/^\d{1,8}$/.test(check.branch) || !/^\d{1,20}$/.test(check.account_number)
      || !clean(check.account_holder, 200) || minor(Number(check.amount)) !== source.amountMinor)
      throw new Error("payper_check_details_invalid");
    paidOn = check.received_date;
    remarks = `המחאה ${check.check_number}; בנק ${check.bank}; סניף ${check.branch}; `
      + `חשבון ${check.account_number}; בעל החשבון ${check.account_holder}; `
      + `התקבלה ${date(check.received_date)}; פירעון ${date(check.due_date)}`;
  } else if (source.method !== "cash" || source.check) throw new Error("payper_payment_method_invalid");
  return {
    terminalNumber: auth.terminalNumber, user: auth.user, password: auth.password,
    trxRecordId: "" as const, Uid: "" as const,
    PayperParameters: { typeDocument: source.documentType, DataPayper: {
      document_lang: "hb" as const, customer_name: source.billing.name,
      customer_unique_id: source.billing.identity, customer_mail: source.billing.email,
      send_by_mail: "true" as const, document_subject: source.receiptNumber,
      document_rounded: "false" as const, invoice_lines: lines,
      receipt_lines: [{ payment_type: source.method === "check" ? "Check" as const : "Cash" as const,
        date: date(paidOn), amount: source.amountMinor }],
      ...(remarks ? { document_remarks: remarks } : {}),
    } },
  };
}

/** A one-shot POST. Any ambiguous result requires reconciliation. */
export async function dispatchNoncardPayper(
  request: ReturnType<typeof buildNoncardPayperRequest>, fetcher: typeof fetch = fetch,
): Promise<PayperDispatchOutcome> {
  try {
    const response = await fetcher(CREATE_PAYPER_INVOICE_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request), redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    const raw = await response.text();
    if (raw.length > 65_536) throw new Error("payper_response_too_large");
    const body = JSON.parse(raw);
    if (!response.ok) return { state: "reconciliation_required", automaticRetryAllowed: false,
      safeCode: "provider_http_error", responseReceived: true };
    const result = classifyDispatchedPayperOutcome({ kind: "response", body });
    return result.state === "succeeded" ? { ...result, responseReceived: true,
      providerStatusCode: "000", invoiceStatus: "Success" }
      : { ...result, safeCode: "provider_response_uncertain", responseReceived: true };
  } catch {
    return { state: "reconciliation_required", automaticRetryAllowed: false,
      safeCode: "provider_transport_uncertain", responseReceived: false };
  }
}
