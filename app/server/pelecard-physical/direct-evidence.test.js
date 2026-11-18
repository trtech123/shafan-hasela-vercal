import test from 'node:test';
import assert from 'node:assert/strict';
import { projectUnlinkedDocumentEvidence } from './direct-evidence.js';
import { directParamX } from './reference.js';

const row = { paymentId: '833db2d6-18b1-4d66-bbcd-4360b95a315c', state: 'uncertain',
  amountMinor: 100, firstResponse: { payment: { statusCode: '000', shvaResult: '000',
    amountMinor: 100, paramX: '833db2d6-18b1-4d66-',
    transactionId: '3199515577', uid: '26111814405328149265672' },
  document: { state: 'succeeded', number: '200006',
    url: 'https://app.payper.co.il/public/invoice_show/3650292?ak=abcdefghijklmnop' } } };

test('projects only a provider-issued but unlinked invoice as review evidence', () => {
  assert.deepEqual(projectUnlinkedDocumentEvidence(row), {
    paymentId: row.paymentId, paymentState: 'uncertain', amountMinor: 100,
    providerTransactionId: '3199515577', documentNumber: '200006',
    documentUrl: row.firstResponse.document.url, linked: false,
  });
});

test('rejects a forged URL or mismatched amount rather than presenting an invoice', () => {
  assert.equal(projectUnlinkedDocumentEvidence({ ...row, amountMinor: 200 }), null);
  assert.equal(projectUnlinkedDocumentEvidence({ ...row, firstResponse: {
    ...row.firstResponse, document: { ...row.firstResponse.document,
      url: 'https://evil.example/public/invoice_show/3650292' } } }), null);
});

test('new J4 evidence must carry the deterministic 19-character reference', () => {
  const current = { ...row, uidRecoveryEnabled: true, firstResponse: {
    ...row.firstResponse, payment: { ...row.firstResponse.payment,
      paramX: directParamX(row.paymentId) } } };
  assert.equal(projectUnlinkedDocumentEvidence(current)?.documentNumber, '200006');
  assert.equal(projectUnlinkedDocumentEvidence({ ...current, firstResponse: {
    ...current.firstResponse, payment: { ...current.firstResponse.payment,
      paramX: row.firstResponse.payment.paramX } } }), null);
});
