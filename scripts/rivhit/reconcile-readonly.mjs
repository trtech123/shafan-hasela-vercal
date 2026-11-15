import { createHmac } from 'node:crypto';

// Pure comparison of a sanitized, authorized export. It does no network or DB writes.
export function reconcileSnapshot(input, { salt } = {}) {
  if (typeof salt !== 'string' || salt.length < 16) throw new Error('private HMAC salt required');
  if (!['complete', 'partial'].includes(input.coverage)) throw new Error('coverage must be complete or partial');
  for (const key of ['payments', 'sales', 'documents', 'rivhitRows']) {
    if (!Array.isArray(input[key])) throw new Error(`${key} must be an array`);
  }
  const ref = value => createHmac('sha256', salt).update(String(value)).digest('hex').slice(0, 16);
  const summary = Object.fromEntries([
    'verifiedPayments', 'officialDocuments', 'officialDocumentMissing', 'rivhitReferenceFound',
    'rivhitReferenceNotFound', 'rivhitSearchIncomplete', 'potentialDuplicate', 'amountMismatch',
    'vatMismatch', 'historicalSalesReview', 'unsupportedMethod', 'reversalReview',
  ].map(key => [key, 0]));
  const cases = [];
  const sales = new Map(input.sales.map(s => [s.id, s]));
  const payments = new Map(input.payments.map(p => [p.id, p]));
  const docsByPayment = new Map();
  for (const doc of input.documents) {
    if (doc.state !== 'succeeded' || !doc.number) continue;
    summary.officialDocuments++;
    const list = docsByPayment.get(doc.paymentId) ?? [];
    list.push(doc);
    docsByPayment.set(doc.paymentId, list);
  }
  const rowsByReference = new Map();
  for (const row of input.rivhitRows) {
    for (const value of [row.reference1, row.reference2]) {
      if (!value) continue;
      const list = rowsByReference.get(String(value)) ?? [];
      if (!list.includes(row)) list.push(row);
      rowsByReference.set(String(value), list);
    }
  }
  const issue = (id, issues) => {
    if (issues.length) cases.push({ caseRef: ref(id), issues: [...new Set(issues)].sort() });
  };
  for (const payment of input.payments) {
    const issues = [];
    if (payment.operation === 'refund' || payment.operation === 'void') {
      summary.reversalReview++;
      issue(payment.id, ['reversal_accounting_review']);
      continue;
    }
    if (payment.operation !== 'payment' || payment.status !== 'succeeded' || !payment.verified) continue;
    summary.verifiedPayments++;
    if (!['pelecard', 'cash'].includes(payment.method)) {
      summary.unsupportedMethod++;
      issues.push('payment_method_mapping_required');
    }
    const sale = sales.get(payment.saleId);
    if (sale && sale.totalMinor !== payment.amountMinor) {
      summary.amountMismatch++;
      issues.push('payment_sale_amount_mismatch');
    }
    const docs = docsByPayment.get(payment.id) ?? [];
    if (!docs.length && payment.documentExpected === 'yes') {
      summary.officialDocumentMissing++;
      issues.push('official_document_missing');
    }
    if (docs.length > 1) {
      summary.potentialDuplicate++;
      issues.push('multiple_official_documents');
    }
    for (const doc of docs) {
      if (doc.saleId !== payment.saleId || doc.paymentId !== payment.id) issues.push('document_link_mismatch');
      if (doc.grossMinor !== payment.amountMinor) {
        summary.amountMismatch++;
        issues.push('payment_document_amount_mismatch');
      }
      const rows = rowsByReference.get(String(doc.number)) ?? [];
      if (!rows.length) {
        if (input.coverage === 'complete') {
          summary.rivhitReferenceNotFound++;
          issues.push('rivhit_reference_not_found_in_complete_export');
        } else {
          summary.rivhitSearchIncomplete++;
          issues.push('rivhit_search_incomplete');
        }
        continue;
      }
      summary.rivhitReferenceFound++;
      // Invoice and receipt legs can share a reference. Only repeated journal IDs
      // are treated as duplicate evidence without an accountant-approved mapping.
      const journalIds = rows.map(row => row.journalId).filter(Boolean);
      if (new Set(journalIds).size < journalIds.length) {
        summary.potentialDuplicate++;
        issues.push('duplicate_journal_identifier');
      }
      const invoiceRows = rows.filter(row => row.kind === 'invoice');
      if (invoiceRows.some(row => row.amountMinor !== doc.grossMinor)) {
        summary.amountMismatch++;
        issues.push('rivhit_invoice_amount_mismatch');
      }
      if (invoiceRows.some(row => row.vatMinor !== doc.vatMinor)) {
        summary.vatMismatch++;
        issues.push('rivhit_invoice_vat_mismatch');
      }
    }
    issue(payment.id, issues);
  }
  for (const sale of input.sales) {
    if (input.payments.some(p => p.saleId === sale.id && p.operation === 'payment') ||
        input.documents.some(d => d.saleId === sale.id && d.state === 'succeeded')) continue;
    summary.historicalSalesReview++;
    issue(sale.id, ['historical_sale_without_verified_payment_or_official_document']);
  }
  cases.sort((a, b) => a.caseRef.localeCompare(b.caseRef));
  return { coverage: input.coverage, summary, cases };
}
