interface SourceInput {
  cutoff: string;
  ledger: {
    id: string; paymentId: string; saleId: string;
    state: string; documentOrigin: string;
    sourceType?: string;
    documentNumber: string | null; documentUrl: string | null; updatedAt: string;
  };
  payment: {
    id: string; saleId: string; status: string; provider: string; currency: string;
    amount: number; createdAt: string; verifiedAt: string | null;
  };
  sale: { id: string; total: number; receiptNumber: string };
  noncard?: { paymentId: string; saleId: string; method: string; amountMinor: number };
}

function instant(value: string | null): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return NaN;
  return Date.parse(value);
}

export function prepareJournalSource(input: SourceInput) {
  const { ledger, payment, sale } = input;
  let documentUrl: URL;
  try { documentUrl = new URL(ledger.documentUrl ?? ""); }
  catch { throw new Error("journal_source_unverified"); }
  const noncardMethod = payment.provider === "manual_cash" ? "cash"
    : payment.provider === "manual_check" ? "check" : null;
  const corroboratedNoncard = noncardMethod !== null
    && ledger.sourceType === payment.provider
    && input.noncard?.paymentId === payment.id && input.noncard?.saleId === sale.id
    && input.noncard.method === noncardMethod
    && input.noncard.amountMinor === Math.round(payment.amount * 100);
  if (ledger.state !== "succeeded" || ledger.documentOrigin !== "automatic"
    || !ledger.documentNumber?.trim() || documentUrl.protocol !== "https:"
    || documentUrl.username || documentUrl.password || documentUrl.port || documentUrl.hash
    || !["payper.co.il", "app.payper.co.il"].includes(documentUrl.hostname)
    || !/^\/(?:app\/)?public\/invoice_show\/[1-9][0-9]*$/.test(documentUrl.pathname)
    || payment.status !== "succeeded" || payment.currency !== "ILS"
    || (noncardMethod ? !corroboratedNoncard : payment.provider !== "pelecard" || !payment.verifiedAt)) {
    throw new Error("journal_source_unverified");
  }
  const cutoff = instant(input.cutoff);
  if (!Number.isFinite(cutoff) || !Number.isFinite(instant(payment.createdAt))
    || (!noncardMethod && !Number.isFinite(instant(payment.verifiedAt)))
    || !Number.isFinite(instant(ledger.updatedAt))) {
    throw new Error("journal_source_unverified");
  }
  if (instant(payment.createdAt) < cutoff
    || (!noncardMethod && instant(payment.verifiedAt) < cutoff)
    || instant(ledger.updatedAt) < cutoff) {
    throw new Error("journal_source_before_cutover");
  }
  if (!ledger.id || !payment.id || !sale.id || !sale.receiptNumber
    || ledger.paymentId !== payment.id || ledger.saleId !== sale.id
    || payment.saleId !== sale.id || !Number.isSafeInteger(payment.amount * 100)
    || payment.amount <= 0 || !Number.isSafeInteger(sale.total * 100)
    || Math.round(payment.amount * 100) !== Math.round(sale.total * 100)) {
    throw new Error("journal_source_mismatch");
  }
  return {
    ledgerId: ledger.id, paymentId: payment.id, saleId: sale.id,
    payperDocumentNumber: ledger.documentNumber,
    payperDocumentUrl: documentUrl.toString(),
    receiptNumber: sale.receiptNumber, amountMinor: Math.round(payment.amount * 100),
  };
}
