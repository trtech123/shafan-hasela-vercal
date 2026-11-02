import { classifyDispatchedPayperOutcome, type PayperDispatchOutcome } from "./outcome.ts";

/** January 2025 Pelecard Services ReST manual, pp. 14-15 and 17-18. */
export const CREATE_PAYPER_INVOICE_URL = "https://gateway21.pelecard.biz/services/CreatePayperInvoice";
export const GET_TRANSACTION_URL = "https://gateway21.pelecard.biz/PaymentGW/GetTransaction";

export interface GatewayCredentials { terminalNumber: string; user: string; password: string }
export interface FrozenPayperFacts {
  paymentId: string; pelecardTransactionId: string; amount: number; currency: string;
  paymentCreatedAt: string; verifiedAt: string; activationCutoffUtc: string;
  orderId: string | null; orderNumber: string; customerKind: "organization" | "person";
  checkoutSnapshot: { items: Array<{ id: string; name: string; qty: number; customPrice: number }>; discount: unknown };
  billing: Record<string, unknown>;
}
export interface CreatePayperInvoiceRequest {
  terminalNumber: string; user: string; password: string; trxRecordId: string; Uid: "";
  PayperParameters: { typeDocument: "Invoice-Receipt"; DataPayper: {
    document_lang: "hb"; customer_unique_id: string; customer_mail: string; customer_name: string;
    send_by_mail?: "true";
    document_subject: string; document_no_vat: "true" | "false"; document_rounded: "false";
    invoice_lines: Array<{ description: string; quantity: string; price_per_unit: string;
      include_vat: "true" | "false"; no_vat?: "true"; catalog_id: string }>;
  } };
}

const safeText = (value: unknown, max = 200): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value
  && !/[\x00-\x1f\x7f]/.test(value);
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function validPersonIdentity(value: unknown): boolean {
  if (typeof value !== "string" || !/^[0-9]{9}$/.test(value) || value === "000000000") return false;
  return [...value].reduce((sum, digit, index) => {
    const product = Number(digit) * (index % 2 === 0 ? 1 : 2);
    return sum + Math.floor(product / 10) + product % 10;
  }, 0) % 10 === 0;
}
function minor(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("payper_invalid_amount");
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) throw new Error("payper_invalid_amount");
  return rounded;
}
function credentials(value: GatewayCredentials): void {
  if (!safeText(value.terminalNumber, 50) || !safeText(value.user, 100) || !safeText(value.password, 200))
    throw new Error("payper_credentials_required");
}
function safeProviderCode(body: unknown): string {
  const value = record(body);
  if (value?.StatusCode === "110") return "provider_credentials_rejected";
  if (value?.StatusCode === "111") return "provider_ip_rejected";
  if (value?.StatusCode === "000" && record(value.PayperData)?.InvoiceStatus !== "Success")
    return "provider_document_rejected";
  return "provider_response_uncertain";
}

/** The stored hosted TransactionId is not the transaction record ID. */
export function decodeTransactionRecord(body: unknown, hostedId: string, amountMinor: number): string {
  const response = record(body);
  const data = record(response?.ResultData);
  const recordId = data?.TransactionPelecardId;
  const digits = typeof recordId === "number" && Number.isSafeInteger(recordId) ? String(recordId) : recordId;
  if (response?.StatusCode !== "000" || !data || data.TransactionId !== hostedId
    || data.ShvaResult !== "000" || String(data.DebitTotal) !== String(amountMinor)
    || String(data.DebitCurrency) !== "1" || typeof digits !== "string" || !/^[1-9][0-9]{0,19}$/.test(digits))
    throw new Error("payper_transaction_mismatch");
  return digits;
}

/** Builds only the transaction-linked form: Pelecard supplies the card receipt. */
export function buildCreatePayperInvoice(
  facts: FrozenPayperFacts, recordId: string, auth: GatewayCredentials,
  options: { sendByMail?: boolean } = {},
): CreatePayperInvoiceRequest {
  credentials(auth);
  if (!/^[1-9][0-9]{0,19}$/.test(recordId) || !safeText(facts.pelecardTransactionId))
    throw new Error("payper_transaction_id_required");
  if (facts.currency !== "ILS" || !safeText(facts.orderNumber) || !safeText(facts.paymentId))
    throw new Error("payper_source_incomplete");
  const vat = facts.billing?.vat_applicable;
  if (typeof vat !== "boolean") throw new Error("payper_vat_contract_mismatch");
  const name = facts.billing.billing_institution_name ?? facts.billing.organization ?? facts.billing.client_name;
  const companyId = facts.billing.billing_company_id;
  const email = facts.billing.billing_accounting_email ?? facts.billing.client_email;
  if (options.sendByMail === true && (!safeText(email, 320) || !/^\S+@\S+\.\S+$/.test(email)))
    throw new Error("payper_email_required");
  if (!safeText(name) ||
    (typeof companyId !== "string" || !/^[0-9]{9}$/.test(companyId)) ||
    (facts.customerKind === "person" && (!validPersonIdentity(companyId) || !safeText(email, 320) || !/^\S+@\S+\.\S+$/.test(email))))
    throw new Error("payper_billing_incomplete");
  const items = facts.checkoutSnapshot?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 1000) throw new Error("payper_items_required");
  let totalMinor = 0;
  let invoiceLines = items.map(item => {
    if (!safeText(item.name) || !safeText(item.id, 100) || !Number.isSafeInteger(item.qty) || item.qty <= 0)
      throw new Error("payper_items_invalid");
    // The legacy order reservation used only ORD-... as its item name.
    // An order reference alone is not a product or service description.
    if (item.name === facts.orderNumber) throw new Error("payper_description_required");
    const unitMinor = minor(item.customPrice);
    totalMinor += unitMinor * item.qty;
    if (!Number.isSafeInteger(totalMinor)) throw new Error("payper_amount_mismatch");
    return { description: item.name, quantity: String(item.qty), price_per_unit: String(unitMinor),
      include_vat: vat ? "true" as const : "false" as const,
      ...(vat ? {} : { no_vat: "true" as const }), catalog_id: item.id };
  });
  const finalMinor = minor(facts.amount);
  const discount = facts.checkoutSnapshot?.discount;
  if (discount != null) {
    const d = record(discount);
    if (facts.orderId !== null || !d || !safeText(d.type, 100) ||
      !["fixed", "percentage"].includes(String(d.mode)) ||
      typeof d.value !== "number" || !Number.isFinite(d.value) || d.value < 0 ||
      typeof d.original_total !== "number" || minor(d.original_total) !== totalMinor ||
      typeof d.final_total !== "number" || minor(d.final_total) !== finalMinor)
      throw new Error("payper_discount_mapping_required");
    const deduction = d.mode === "fixed" ? minor(d.value) :
      Math.round(totalMinor * minor(d.value) / 10_000);
    if (d.mode === "percentage" && d.value > 100 || totalMinor - deduction !== finalMinor)
      throw new Error("payper_discount_mapping_required");
    const description = items.map(item => `${item.name}${item.qty === 1 ? "" : ` × ${item.qty}`}`).join(", ") + ` — ${d.type}`;
    if (!safeText(description, 200)) throw new Error("payper_description_required");
    invoiceLines = [{ description, quantity: "1", price_per_unit: String(finalMinor),
      include_vat: vat ? "true" as const : "false" as const,
      ...(vat ? {} : { no_vat: "true" as const }), catalog_id: items[0].id }];
  } else if (totalMinor !== finalMinor) throw new Error("payper_amount_mismatch");
  return { terminalNumber: auth.terminalNumber, user: auth.user, password: auth.password,
    trxRecordId: recordId, Uid: "", PayperParameters: { typeDocument: "Invoice-Receipt", DataPayper: {
      document_lang: "hb", customer_unique_id: companyId as string,
      customer_mail: safeText(email, 320) ? email : "", customer_name: name,
      ...(options.sendByMail === true ? { send_by_mail: "true" as const } : {}),
      document_subject: facts.orderNumber, document_no_vat: vat ? "false" : "true",
      document_rounded: "false", invoice_lines: invoiceLines,
    } } };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("payper_invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65_536) { await reader.cancel(); throw new Error("payper_invalid_response"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function createPelecardPayperProvider(options: {
  credentials: GatewayCredentials; fetcher?: typeof fetch; dispatchEnabled?: boolean; timeoutMs?: number;
}) {
  const fetcher = options.fetcher ?? fetch;
  const timeout = options.timeoutMs ?? 15_000;
  credentials(options.credentials);
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 30_000) throw new Error("payper_timeout_invalid");
  return {
    async lookupTransaction(hostedId: string, amountMinor: number): Promise<string> {
      if (!safeText(hostedId) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0)
        throw new Error("payper_lookup_input_invalid");
      try {
        const response = await fetcher(GET_TRANSACTION_URL, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ terminal: options.credentials.terminalNumber, user: options.credentials.user,
            password: options.credentials.password, TransactionId: hostedId }),
          redirect: "error", signal: AbortSignal.timeout(timeout) });
        if (!response.ok) throw new Error("payper_lookup_failed");
        return decodeTransactionRecord(await readJson(response), hostedId, amountMinor);
      } catch (error) {
        if (error instanceof Error && error.message === "payper_transaction_mismatch") throw error;
        throw new Error("payper_lookup_failed");
      }
    },
    async createInvoice(request: CreatePayperInvoiceRequest, reservationId: string): Promise<PayperDispatchOutcome> {
      if (!options.dispatchEnabled) throw new Error("payper_dispatch_disabled");
      if (!safeText(reservationId) || !/^[1-9][0-9]{0,19}$/.test(request.trxRecordId))
        throw new Error("payper_reservation_required");
      // A caller must first obtain the database's one-shot dispatch reservation.
      // Every response or transport failure after this point needs reconciliation.
      try {
        const response = await fetcher(CREATE_PAYPER_INVOICE_URL, { method: "POST",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
          redirect: "error", signal: AbortSignal.timeout(timeout) });
        const body = await readJson(response);
        if (!response.ok) return { state: "reconciliation_required", automaticRetryAllowed: false,
          safeCode: "provider_http_error" };
        const outcome = classifyDispatchedPayperOutcome({ kind: "response", body });
        return outcome.state === "succeeded" ? outcome : { ...outcome, safeCode: safeProviderCode(body) };
      } catch {
        return { state: "reconciliation_required", automaticRetryAllowed: false,
          safeCode: "provider_transport_uncertain" };
      }
    },
  };
}
