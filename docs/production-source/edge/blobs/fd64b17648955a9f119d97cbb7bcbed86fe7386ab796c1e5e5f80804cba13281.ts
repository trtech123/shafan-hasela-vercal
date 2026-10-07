import type {
  DocumentMapping,
  MappedAccountingSource,
  OrderSource,
} from "./types.ts";

function normalizeDigits(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function truncate(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function identityInput(order: OrderSource, accountingEmail: string): string {
  const companyId = normalizeDigits(order.billing_company_id);
  if (companyId) return `company:${companyId}`;
  if (accountingEmail) return `email:${accountingEmail}`;
  const phone = normalizeDigits(order.client_phone);
  if (phone) return `phone:${phone}`;
  return `order:${order.id}`;
}

export interface OrderAccountingCustomerIdentity {
  customerName: string;
  accountingEmail: string;
  identityKey: string;
  externalCustomerReference: string;
  customerRequestReference: string;
  customer: MappedAccountingSource["customer"];
}

export class MissingOrderAccountingCustomerIdentityError extends Error {
  constructor() {
    super("Order has no accounting customer name");
    this.name = "MissingOrderAccountingCustomerIdentityError";
  }
}

export async function mapOrderAccountingCustomerIdentity(
  order: OrderSource,
  fallbackName: string | null = "Shafan customer",
): Promise<OrderAccountingCustomerIdentity> {
  const sourceName = order.billing_institution_name
    || order.organization
    || order.client_name;
  if (!sourceName?.trim() && fallbackName === null) {
    throw new MissingOrderAccountingCustomerIdentityError();
  }
  const customerName = truncate(sourceName || fallbackName || "", 30);
  const accountingEmail = normalizeEmail(
    order.billing_accounting_email || order.client_email,
  );
  const identityKey = await sha256Hex(identityInput(order, accountingEmail));
  const externalCustomerReference = `sh${identityKey.slice(0, 18)}`;
  const customerRequestReference = `shafan:rivhit:customer:${externalCustomerReference}`;
  const email = accountingEmail || undefined;
  const phone = truncate(String(order.client_phone || ""), 15) || undefined;
  const customer = {
    last_name: customerName,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    acc_ref: externalCustomerReference,
    request_reference: customerRequestReference,
  };

  return {
    customerName,
    accountingEmail,
    identityKey,
    externalCustomerReference,
    customerRequestReference,
    customer,
  };
}

export async function mapOrderToAccountingSource(
  order: OrderSource,
  activityName: string | null,
  documentTypeKey: string,
  mapping: DocumentMapping,
  accountNamespace: string,
): Promise<MappedAccountingSource> {
  if (!accountNamespace.trim()) {
    throw new Error("RIVHIT_ACCOUNT_NAMESPACE is not configured");
  }
  const {
    customerName,
    accountingEmail,
    identityKey,
    externalCustomerReference,
    customerRequestReference,
    customer,
  } = await mapOrderAccountingCustomerIdentity(order);
  const documentRequestReference =
    `shafan:rivhit:order:${order.id}:${documentTypeKey}`;

  const participants = positiveNumber(order.num_participants);
  const pricePerPerson = positiveNumber(order.price_per_person);
  const totalPrice = positiveNumber(order.total_price);
  const quantity = participants && pricePerPerson ? participants : 1;
  const price = participants && pricePerPerson ? pricePerPerson : totalPrice;
  if (!price) {
    throw new Error("Order has no positive accounting amount");
  }

  const orderNumber = truncate(order.order_number || order.id, 15);
  const itemDescription = truncate(
    `${activityName || "Shafan order"} / ${orderNumber}`,
    30,
  );
  const email = accountingEmail || undefined;
  const document = {
    document_type: mapping.document_type,
    last_name: customerName,
    ...(orderNumber ? { order: orderNumber } : {}),
    comments: truncate(`Shafan order ${orderNumber}`, 400),
    sort_code: mapping.sort_code,
    price_include_vat: mapping.price_include_vat,
    currency_id: mapping.currency_id,
    language: "he" as const,
    ...(mapping.send_mail && email ? { email_to: email } : {}),
    digital_signature: mapping.digital_signature,
    items: [{ item_id: 0, quantity, price_nis: price, description: itemDescription }],
    request_reference: documentRequestReference,
    prevent_duplicates: true as const,
    create_items: false as const,
    no_update_inventory: true as const,
    send_mail: mapping.send_mail,
  };
  const payloadHash = await sha256Hex(stableStringify({
    accountNamespace,
    documentTypeKey,
    externalCustomerReference,
    document,
  }));

  return {
    provider: "rivhit",
    accountNamespace,
    sourceType: "order",
    sourceId: order.id,
    documentTypeKey,
    identityKey,
    externalCustomerReference,
    customerRequestReference,
    documentRequestReference,
    payloadHash,
    customer,
    document,
  };
}
