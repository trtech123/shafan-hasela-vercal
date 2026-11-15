export interface JournalSourceInput {
  accountNamespace: string;
  sourceSystem: "payper";
  sourceDocumentId: string;
  documentNumber: string;
  paymentId: string;
  saleId: string;
  documentType: string;
  issuedAt: string;
  grossMinor: number;
  currency: "ILS";
}

export function createJournalSource(input: JournalSourceInput) {
  if (input.sourceSystem !== "payper" || !input.accountNamespace?.trim() || !input.sourceDocumentId?.trim()
    || !input.documentNumber?.trim() || !input.paymentId?.trim()
    || !input.saleId?.trim() || !input.documentType?.trim()
    || !Number.isSafeInteger(input.grossMinor) || input.grossMinor <= 0
    || !Number.isFinite(Date.parse(input.issuedAt)) || input.currency !== "ILS") {
    throw new Error("invalid_journal_source");
  }
  return Object.freeze({ ...input,
    identityKey: `${input.accountNamespace}:payper:${input.sourceDocumentId}` });
}
