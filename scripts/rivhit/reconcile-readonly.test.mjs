import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSnapshot } from './reconcile-readonly.mjs';

const salt = 'synthetic-reconciliation-salt-1234';
const payment = { id: 'payment-secret-1', operation: 'payment', status: 'succeeded',
  verified: true, amountMinor: 400, currency: 'ILS', method: 'pelecard',
  saleId: 'sale-secret-1', documentExpected: 'yes' };
const sale = { id: 'sale-secret-1', receiptNumber: 'RCP-1026',
  totalMinor: 400, method: 'pelecard' };
const document = { id: 'document-secret-1', paymentId: payment.id, saleId: sale.id,
  state: 'succeeded', number: '200002', grossMinor: 400, vatMinor: 61 };
const snapshot = overrides => ({ coverage: 'complete', payments: [payment], sales: [sale],
  documents: [document], rivhitRows: [], ...overrides });

test('recognizes two distinct journal legs without treating them as duplicates', () => {
  const report = reconcileSnapshot(snapshot({ rivhitRows: [
    { journalId: 'journal-1', reference1: '200002', kind: 'invoice', amountMinor: 400, vatMinor: 61 },
    { journalId: 'journal-2', reference1: '200002', kind: 'receipt', amountMinor: 400, vatMinor: 0 },
  ] }), { salt });
  assert.equal(report.summary.verifiedPayments, 1);
  assert.equal(report.summary.officialDocuments, 1);
  assert.equal(report.summary.rivhitReferenceFound, 1);
  assert.equal(report.summary.potentialDuplicate, 0);
  assert.deepEqual(report.cases, []);
});

test('keeps missing document and incomplete Rivhit coverage separate', () => {
  const report = reconcileSnapshot(snapshot({ coverage: 'partial', documents: [] }), { salt });
  assert.equal(report.summary.officialDocumentMissing, 1);
  assert.equal(report.summary.rivhitReferenceNotFound, 0);
  assert.ok(report.cases[0].issues.includes('official_document_missing'));
  assert.doesNotMatch(JSON.stringify(report), /payment-secret|sale-secret|200002|RCP-1026/);
});

test('flags exact duplicate journal evidence, amount and VAT discrepancies', () => {
  const report = reconcileSnapshot(snapshot({ rivhitRows: [
    { journalId: 'journal-1', reference1: '200002', kind: 'invoice', amountMinor: 450, vatMinor: 62 },
    { journalId: 'journal-1', reference1: '200002', kind: 'invoice', amountMinor: 450, vatMinor: 62 },
  ] }), { salt });
  assert.equal(report.summary.potentialDuplicate, 1);
  assert.equal(report.summary.amountMismatch, 1);
  assert.equal(report.summary.vatMismatch, 1);
});

test('does not call an internal RCP confirmation an official document', () => {
  const report = reconcileSnapshot(snapshot({ payments: [], documents: [], sales: [
    { id: 'sale-1039', receiptNumber: 'RCP-1039', method: 'check', totalMinor: 100 },
    { id: 'sale-1043', receiptNumber: 'RCP-1043', method: 'cash', totalMinor: 100 },
  ] }), { salt });
  assert.equal(report.summary.historicalSalesReview, 2);
  assert.equal(report.summary.officialDocuments, 0);
  assert.equal(report.summary.rivhitReferenceFound, 0);
});

test('holds refunds and unmapped payment methods for accountant review', () => {
  const report = reconcileSnapshot(snapshot({ payments: [
    { ...payment, id: 'check-payment', method: 'check', saleId: 'check-sale' },
    { ...payment, id: 'refund-secret', operation: 'refund', saleId: null },
  ], sales: [], documents: [] }), { salt });
  assert.equal(report.summary.unsupportedMethod, 1);
  assert.equal(report.summary.reversalReview, 1);
  assert.equal(report.summary.officialDocumentMissing, 1);
});

test('never declares absence from Rivhit when report coverage is incomplete', () => {
  const partial = reconcileSnapshot(snapshot({ coverage: 'partial' }), { salt });
  const complete = reconcileSnapshot(snapshot({ coverage: 'complete' }), { salt });
  assert.equal(partial.summary.rivhitReferenceNotFound, 0);
  assert.equal(partial.summary.rivhitSearchIncomplete, 1);
  assert.equal(complete.summary.rivhitReferenceNotFound, 1);
});
