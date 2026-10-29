import { PaymentError } from "./payment-types.ts";

export interface ExpectedLiveTransaction {
  transactionId: string;
  confirmationKey: string;
  amountMinor: number;
  currency: "ILS";
}
export type LiveVerificationResult =
  | { approved: true; apiStatus: "000"; transactionStatus: "000"; emvStatus: "000" | null; approvalId: string }
  | { approved: false; apiStatus: string; transactionStatus: string | null; emvStatus: string | null };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function invalid(): never { throw new PaymentError("invalid_provider_response"); }
// Retain digit status text exactly, including unapproved "00". Arbitrary
// provider text is never part of returned evidence or an exception.
function status(value: unknown): string {
  if (typeof value !== "string" || !/^\d{2,3}$/.test(value)) return invalid();
  return value;
}
function opaque(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
}

/** REST manual January 2025 pp17–18: GetTransaction ResultData is mandatory
 * on success; ValidateByUniqueKey is separate correlation evidence only.
 * pp33–34 define ILS=1, amount in agorot and ordinary debit types 01/02.
 * https://gateway21.pelecard.biz/PaymentGW/GetTransaction (documented action).
 * This pure decoder performs no validation request, settlement or logging.
 */
export function verifyGetTransaction(response: unknown, expected: ExpectedLiveTransaction): LiveVerificationResult {
  if (expected.amountMinor !== 3500) return invalid();
  return verifyOrderGetTransaction(response,expected);
}
export function verifyOrderGetTransaction(response:unknown,expected:ExpectedLiveTransaction):LiveVerificationResult {
  if (!Number.isSafeInteger(expected.amountMinor) || expected.amountMinor < 1 || expected.amountMinor > 2147483647 || expected.currency !== "ILS" || !opaque(expected.transactionId) || !opaque(expected.confirmationKey)) return invalid();
  const envelope = object(response);
  if (!envelope) return invalid();
  const apiStatus = status(envelope.StatusCode);
  const data = object(envelope.ResultData);
  const transactionStatus = data?.ShvaResult === undefined ? null : status(data.ShvaResult);
  const emvStatus = data?.ShvaResultEmv === undefined ? null : status(data.ShvaResultEmv);
  if (apiStatus !== "000") return { approved: false, apiStatus, transactionStatus, emvStatus };
  if (!data || transactionStatus === null) return invalid();
  if (transactionStatus !== "000" || (emvStatus !== null && emvStatus !== "000")) {
    return { approved: false, apiStatus, transactionStatus, emvStatus };
  }
  if (data.TransactionId !== expected.transactionId || data.ConfirmationKey !== expected.confirmationKey ||
    data.JParam !== "4" || (data.DebitTotal !== String(expected.amountMinor) && data.DebitTotal !== expected.amountMinor) || data.DebitCurrency !== "1" ||
    !["1", "01", "2", "02"].includes(data.DebitType as string) || !["1", "2", "3"].includes(data.ApprovedBy as string) ||
    !opaque(data.DebitApproveNumber)) return invalid();
  return { approved: true, apiStatus: "000", transactionStatus: "000", emvStatus: emvStatus as "000" | null, approvalId: data.DebitApproveNumber };
}
