import type {
  MappedAccountingSource,
  OrderSource,
} from "../rivhit/types.ts";

export interface VerifiedPaymentCheckoutItem {
  id: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
}

export interface VerifiedPelecardPaymentSource {
  id: string;
  provider: "pelecard";
  operation: "payment";
  status: "succeeded";
  orderId: string | null;
  saleId: string;
  providerTransactionId: string;
  amountMinor: number;
  currencyCode: string;
  verifiedAt: string;
  checkoutItems: VerifiedPaymentCheckoutItem[];
  order: OrderSource | null;
  activityName: string | null;
}

export interface MappedPaymentAccountingSource extends MappedAccountingSource {
  sourceType: "payment_transaction";
  documentTypeKey: "payment_success";
  paymentAmountMinor: number;
  currencyCode: string;
}
