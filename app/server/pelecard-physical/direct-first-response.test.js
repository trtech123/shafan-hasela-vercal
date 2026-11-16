import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDirectFirstResponse } from './direct-first-response.js';

const invoiceUrl = 'https://app.payper.co.il/public/invoice_show/595170?ak=abcdefghijklmnop';

test('captures the first J4 approval and Payper document without card data', () => {
  const result = projectDirectFirstResponse({ StatusCode: '000', PelecardTransactionId: '12345',
    ShvaResult: '000', DebitTotal: '1500', DebitCurrency: '1', DebitApproveNumber: '76543',
    UID: 'uid-1', AdditionalDetailsParamX: 'intent-1',
    PayperData: { InvoiceStatus: 'Success', InvoiceNumber: '595170', InvoiceLink: invoiceUrl,
      RawResponse: '{"document_system_id":595170,"document_id":"550","pan":"4111111111111111"}' },
    CreditCardNumber: '411111******1111', track2: 'private' });
  assert.equal(result.payment.transactionId, '12345');
  assert.equal(result.payment.amountMinor, 1500);
  assert.equal(result.document.state, 'succeeded');
  assert.equal(result.document.number, '595170');
  assert.equal(result.document.url, invoiceUrl);
  assert.equal(result.document.systemId, '595170');
  assert.equal(result.document.documentId, '550');
  assert.doesNotMatch(JSON.stringify(result), /411111|private|RawResponse/);
});

test('approved J4 with invoice failure preserves payment and reconciliation state', () => {
  const result = projectDirectFirstResponse({ StatusCode: '000', ShvaResult: '000',
    PelecardTransactionId: '12345', DebitTotal: '1500', PayperData: {
      InvoiceStatus: 'Error', InvoiceError: 'provider error' } });
  assert.equal(result.payment.transactionId, '12345');
  assert.equal(result.document.state, 'reconciliation_required');
  assert.equal(result.document.status, 'Error');
  assert.doesNotMatch(JSON.stringify(result), /provider error/);
});

test('malformed invoice link cannot be treated as an issued document', () => {
  const result = projectDirectFirstResponse({ StatusCode: '000', PayperData: {
    InvoiceStatus: 'Success', InvoiceNumber: '595170', InvoiceLink: 'https://evil.test/invoice/595170' } });
  assert.equal(result.document.state, 'reconciliation_required');
});
