/** Provider-independent facts only. This module cannot construct or send a Payper document. */
import { isPostActivationPayment } from "./cutoff.ts";
export interface PayperIntentInput {
  activationCutoffUtc: string | null;
  payment: {
    id: string; provider: string; operation: string; status: string; createdAt: string; verifiedAt: string | null;
    providerTransactionId: string | null; orderId: string | null; saleId: string | null;
    amountMinor: number; currencyCode: string;
    checkoutItems: Array<{ id: string; name: string; quantity: number; unitPriceMinor: number }>;
  };
  sale: { id: string; orderId: string; paymentId: string; amountMinor: number };
  order: { id: string; orderNumber: string; saleId: string; amountMinor: number; customerSnapshotId: string | null };
  customerSnapshot: {
    id: string; orderId: string; customerId: string; version: number; kind: string;
    billingName: string; companyId: string | null; accountingEmail: string | null;
    vatApplicable: boolean | null;
  };
}

export type PayperMissingField =
  | "verified_payment" | "payment_transaction_id" | "ils_payment" | "positive_amount"
  | "checkout_items" | "payment_order_link" | "sale_payment_link" | "sale_order_link"
  | "sale_amount_match" | "order_sale_link" | "order_amount_match"
  | "customer_snapshot_link" | "customer_name" | "company_id"
  | "customer_email_or_identity" | "vat_decision" | "activation_cutoff";

export interface PayperSourceIntent {
  readonly paymentId: string;
  readonly paymentCreatedAt: string;
  readonly activationCutoffUtc: string;
  readonly pelecardTransactionId: string;
  readonly verifiedAt: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly saleId: string;
  readonly amountMinor: number;
  readonly currencyCode: "ILS";
  readonly customerSnapshotId: string;
  readonly customerSnapshotVersion: number;
  readonly customerId: string;
  readonly customerKind: "person" | "organization";
  readonly customerName: string;
  readonly customerUniqueId: string | null;
  readonly customerEmail: string | null;
  readonly vatApplicable: boolean;
  readonly items: ReadonlyArray<Readonly<{ id: string; name: string; quantity: number; unitPriceMinor: number }>>;
  readonly fingerprint: string;
}

export type PayperIntentResult =
  | { status: "missing_fields"; fields: PayperMissingField[] }
  | { status: "source_complete"; intent: PayperSourceIntent };

const isPositiveMinor = (value: number) => Number.isSafeInteger(value) && value > 0;
const nonempty = (value: string | null | undefined) => typeof value === "string" && value.trim().length > 0;

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function preparePayperIntent(input: PayperIntentInput): Promise<PayperIntentResult> {
  const { payment: p, sale: s, order: o, customerSnapshot: c } = input;
  const fields: PayperMissingField[] = [];
  if (p.provider !== "pelecard" || p.operation !== "payment" || p.status !== "succeeded" || !nonempty(p.verifiedAt)) fields.push("verified_payment");
  if (!isPostActivationPayment(p.createdAt, p.verifiedAt, input.activationCutoffUtc)) fields.push("activation_cutoff");
  if (!nonempty(p.providerTransactionId)) fields.push("payment_transaction_id");
  if (p.currencyCode !== "ILS") fields.push("ils_payment");
  if (!isPositiveMinor(p.amountMinor)) fields.push("positive_amount");
  if (!Array.isArray(p.checkoutItems) || p.checkoutItems.length === 0 || p.checkoutItems.some(item =>
    !nonempty(item.id) || !nonempty(item.name) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !isPositiveMinor(item.unitPriceMinor))) fields.push("checkout_items");
  if (p.orderId !== o.id || !nonempty(o.id) || !nonempty(o.orderNumber)) fields.push("payment_order_link");
  if (s.paymentId !== p.id || p.saleId !== s.id || !nonempty(p.id)) fields.push("sale_payment_link");
  if (s.orderId !== o.id) fields.push("sale_order_link");
  if (s.amountMinor !== p.amountMinor) fields.push("sale_amount_match");
  if (o.saleId !== s.id) fields.push("order_sale_link");
  if (o.amountMinor !== p.amountMinor) fields.push("order_amount_match");
  if (o.customerSnapshotId !== c.id || c.orderId !== o.id || !nonempty(c.customerId) || !Number.isSafeInteger(c.version) || c.version <= 0) fields.push("customer_snapshot_link");
  if (!nonempty(c.billingName)) fields.push("customer_name");
  if (c.kind === "organization") {
    if (!/^[0-9]{9}$/.test(c.companyId?.trim() ?? "")) fields.push("company_id");
  } else if (c.kind === "person") {
    if (!/^[0-9]{9}$/.test(c.companyId ?? "") || c.companyId === "000000000") fields.push("company_id");
    if (!/^\S+@\S+\.\S+$/.test(c.accountingEmail?.trim() ?? "")) fields.push("customer_email_or_identity");
  } else {
    fields.push("customer_name");
  }
  if (typeof c.vatApplicable !== "boolean") fields.push("vat_decision");
  if (fields.length) return { status: "missing_fields", fields };

  const items = p.checkoutItems.map(item => Object.freeze({
    id: item.id.trim(), name: item.name.trim(), quantity: item.quantity, unitPriceMinor: item.unitPriceMinor,
  }));
  const facts = {
    paymentId: p.id, paymentCreatedAt: p.createdAt, activationCutoffUtc: input.activationCutoffUtc!,
    pelecardTransactionId: p.providerTransactionId!.trim(), verifiedAt: p.verifiedAt!.trim(),
    orderId: o.id, orderNumber: o.orderNumber.trim(), saleId: s.id,
    amountMinor: p.amountMinor, currencyCode: "ILS" as const,
    customerSnapshotId: c.id, customerSnapshotVersion: c.version, customerId: c.customerId,
    customerKind: c.kind as "person" | "organization", customerName: c.billingName.trim(),
    customerUniqueId: c.companyId!.trim(),
    customerEmail: nonempty(c.accountingEmail) ? c.accountingEmail!.trim().toLowerCase() : null,
    vatApplicable: c.vatApplicable!, items: Object.freeze(items),
  };
  return { status: "source_complete", intent: Object.freeze({ ...facts, fingerprint: await fingerprint(facts) }) };
}
