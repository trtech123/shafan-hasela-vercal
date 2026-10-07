import { RivhitError } from './client.ts';
import {validateFrozenVat,type FrozenVat} from './immediate-vat.ts';

export interface ExpectedImmediateDocument {
  companyId: number;
  customerId: string;
  orderNumber: string;
  amountMinor: number;
  requestReference: string;
  paymentType: number;
  paymentName?: string;
  voucherNumber?: number;
  vat?:FrozenVat;
}
export interface DocumentLookupClient {
  lookupDocumentRequest(reference: string): Promise<unknown>;
  getDocumentDetails(type: number, number: number): Promise<unknown>;
}
function uncertain(): never {
  throw new RivhitError('Rivhit document evidence mismatch', { reconciliationRequired: true });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return uncertain();
  return value as Record<string, unknown>;
}
function integer(value: unknown): number {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))) return uncertain();
  const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) return uncertain(); return n;
}
function minor(value: unknown): number {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value))) return uncertain();
  const n = Number(value) * 100;
  if (!Number.isFinite(n) || n < 0 || Math.abs(n - Math.round(n)) > 0.000001 || !Number.isSafeInteger(Math.round(n))) return uncertain();
  return Math.round(n);
}
function matchesDocumentIdentity(detail:Record<string,unknown>,number:number):boolean {
  if(detail.document_type==='חשבונית מס קבלה'){
    const match=typeof detail.document_number==='string'?/^(\d{2,3})\/(\d{1,9})$/.exec(detail.document_number):null;
    return Boolean(match&&Number(match[1])===2&&Number(match[2])===number);
  }
  return integer(detail.document_type)===2&&integer(detail.document_number)===number;
}
/** Do not expose non-provider, insecure or credential-bearing document links. */
export function safeRivhitDocumentUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'rivhit.co.il' || url.hostname.endsWith('.rivhit.co.il')) ? url.href : null;
  } catch { return null; }
}

/** Both calls are read-only. This function never claims, issues, sends or cancels. */
export async function reconcileImmediateDocument(client: DocumentLookupClient, expected: ExpectedImmediateDocument) {
  let frozen:FrozenVat;
  try{frozen=validateFrozenVat(expected.vat,expected.amountMinor,expected.vat?.applicable);}catch{return uncertain();}
  if (!expected.requestReference.trim() || !expected.orderNumber || !Number.isSafeInteger(expected.amountMinor) || expected.amountMinor <= 0 ||
    !Number.isSafeInteger(expected.companyId) || expected.companyId <= 0 || !/^\d+$/.test(expected.customerId) || Number(expected.customerId) < 1) return uncertain();
  const issued = record(await client.lookupDocumentRequest(expected.requestReference));
  const documentNumber = integer(issued.document_number);
  if (integer(issued.document_type) !== 2 || integer(issued.customer_id) !== Number(expected.customerId) || documentNumber < 1 ||
    typeof issued.document_identity !== 'string' || !issued.document_identity.trim()) return uncertain();
  const detail = record(await client.getDocumentDetails(2, documentNumber));
  if (integer(detail.company_id) !== expected.companyId || integer(detail.customer_id) !== Number(expected.customerId) ||
    !matchesDocumentIdentity(detail,documentNumber) || detail.order !== expected.orderNumber ||
    integer(detail.currency_id) !== 1 || integer(detail.sort_code) !== 100 || detail.price_include_vat !== true || !/^\d+(?:\.\d{1,2})?%?$/.test(String(detail.vat_percent)) || Number(String(detail.vat_percent).replace('%',''))!==frozen.vatPercent ||
    detail.is_cancelled !== false || minor(detail.document_total) !== expected.amountMinor || minor(detail.receipt_total) !== expected.amountMinor ||
    minor(detail.total_vat) !== frozen.vatMinor ||
    minor(detail.total_without_vat) !== frozen.netMinor) return uncertain();
  if (!Array.isArray(detail.payments) || detail.payments.length !== 1) return uncertain();
  const payment = record(detail.payments[0]);
  const paymentId=integer(payment.payment_type_id);
  const matchesType=paymentId===expected.paymentType || (paymentId===0 && Boolean(expected.paymentName) && payment.payment_type===expected.paymentName);
  if (!matchesType || minor(payment.amount) !== expected.amountMinor ||
    (expected.voucherNumber !== undefined && integer(payment.check_number) !== expected.voucherNumber)) return uncertain();
  const printStatus = typeof issued.print_status === 'number' ? issued.print_status : null;
  const documentUrl = printStatus !== null && printStatus < 0 ? null : safeRivhitDocumentUrl(issued.document_link);
  return {
    status: documentUrl ? 'succeeded' as const : 'artifact_required' as const,
    document: { customerId: expected.customerId, documentType: 2, documentId: issued.document_identity,
      documentNumber: String(documentNumber), documentUrl, amount: expected.amountMinor / 100 },
    printStatus,
  };
}
