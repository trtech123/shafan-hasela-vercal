import {
  mapOrderAccountingCustomerIdentity,
  MissingOrderAccountingCustomerIdentityError,
  sha256Hex,
  stableStringify,
} from "../rivhit/order-mapper.ts";
import type { DocumentMapping } from "../../../_shared/rivhit/types.ts";
import type {
  MappedPaymentAccountingSource,
  VerifiedPelecardPaymentSource,
} from "../../../_shared/payment-accounting/types.ts";

const DOCUMENT_TYPE_KEY = "payment_success" as const;

export class PaymentAccountingReconciliationError extends Error {
  readonly code: "missing_order" | "missing_billing_identity";

  constructor(code: PaymentAccountingReconciliationError["code"]) {
    super(code);
    this.name = "PaymentAccountingReconciliationError";
    this.code = code;
  }
}

export class PaymentAccountingConfigurationError extends Error {
  readonly code: "missing_currency_code" | "currency_mismatch";

  constructor(code: PaymentAccountingConfigurationError["code"]) {
    super(code);
    this.name = "PaymentAccountingConfigurationError";
    this.code = code;
  }
}

function truncate(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function itemDescription(source: VerifiedPelecardPaymentSource): string {
  const itemNames = source.checkoutItems
    .map((item) => item.name.trim())
    .filter(Boolean)
    .join(" + ");
  const orderNumber = source.order?.order_number || source.orderId;
  return truncate(`${itemNames || "Shafan payment"} / ${orderNumber}`, 30);
}

export async function mapVerifiedPaymentToAccountingSource(
  source: VerifiedPelecardPaymentSource,
  mapping: DocumentMapping,
  accountNamespace: string,
): Promise<MappedPaymentAccountingSource> {
  if (!accountNamespace.trim()) {
    throw new Error("RIVHIT_ACCOUNT_NAMESPACE is not configured");
  }
  if (!Number.isSafeInteger(source.amountMinor) || source.amountMinor <= 0) {
    throw new Error("Payment has no positive accounting amount");
  }
  if (!mapping.currency_code) {
    throw new PaymentAccountingConfigurationError("missing_currency_code");
  }
  if (mapping.currency_code !== source.currencyCode) {
    throw new PaymentAccountingConfigurationError("currency_mismatch");
  }
  if (!source.order || source.order.id !== source.orderId) {
    throw new PaymentAccountingReconciliationError("missing_order");
  }

  let customerIdentity;
  try {
    customerIdentity = await mapOrderAccountingCustomerIdentity(source.order, null);
  } catch (error) {
    if (error instanceof MissingOrderAccountingCustomerIdentityError) {
      throw new PaymentAccountingReconciliationError("missing_billing_identity");
    }
    throw error;
  }

  const orderNumber = truncate(source.order.order_number || source.orderId, 15);
  const documentRequestReference =
    `shafan:rivhit:payment:${source.id}:${DOCUMENT_TYPE_KEY}`;
  const email = customerIdentity.accountingEmail || undefined;
  const document = {
    document_type: mapping.document_type,
    last_name: customerIdentity.customerName,
    ...(orderNumber ? { order: orderNumber } : {}),
    comments: truncate(`Shafan payment ${source.id}`, 400),
    sort_code: mapping.sort_code,
    price_include_vat: mapping.price_include_vat,
    currency_id: mapping.currency_id,
    language: "he" as const,
    ...(mapping.send_mail && email ? { email_to: email } : {}),
    digital_signature: mapping.digital_signature,
    items: [{
      item_id: 0,
      quantity: 1,
      price_nis: source.amountMinor / 100,
      description: itemDescription(source),
    }],
    request_reference: documentRequestReference,
    prevent_duplicates: true as const,
    create_items: false as const,
    no_update_inventory: true as const,
    send_mail: mapping.send_mail,
  };
  const payloadHash = await sha256Hex(stableStringify({
    accountNamespace,
    documentTypeKey: DOCUMENT_TYPE_KEY,
    sourceId: source.id,
    paymentAmountMinor: source.amountMinor,
    currencyCode: source.currencyCode,
    checkoutItems: source.checkoutItems.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
    })),
    externalCustomerReference: customerIdentity.externalCustomerReference,
    document,
  }));

  return {
    provider: "rivhit",
    accountNamespace,
    sourceType: "payment_transaction",
    sourceId: source.id,
    documentTypeKey: DOCUMENT_TYPE_KEY,
    paymentAmountMinor: source.amountMinor,
    currencyCode: source.currencyCode,
    identityKey: customerIdentity.identityKey,
    externalCustomerReference: customerIdentity.externalCustomerReference,
    customerRequestReference: customerIdentity.customerRequestReference,
    documentRequestReference,
    payloadHash,
    customer: customerIdentity.customer,
    document,
  };
}
