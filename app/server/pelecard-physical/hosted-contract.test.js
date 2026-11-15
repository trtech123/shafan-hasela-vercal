import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHostedEmvRequest, classifyHostedEmvResult, parseHostedPayperData } from './hosted-contract.js';

const id = '11111111-1111-4111-8111-111111111111';
const base = { id, register: '004', amountMinor: 11800,
  checkoutSnapshot: { items: [{ name: 'Group climbing', qty: 2, customPrice: 59 }], discount: null },
  billingSnapshot: { kind: 'person', name: 'Synthetic Customer', identity: '123456782',
    email: 'synthetic@example.test', vatApplicable: true } };
const credentials = { terminal: '1234567890', user: 'synthetic-user', password: 'synthetic-secret' };
const result = { StatusCode: '000', ResultData: { TransactionId: 'hosted-1',
  ConfirmationKey: 'synthetic-confirmation',
  TransactionPelecardId: '12345', ShvaResult: '000', ShvaResultEmv: '000',
  DebitTotal: '11800', DebitCurrency: '1', Uid: 'uid-1', DebitApproveNumber: '1234567' },
  PayperData: { InvoiceStatus: '000', InvoiceNumber: '595170',
    InvoiceLink: 'https://app.payper.co.il/public/invoice_show/595170?ak=abcdefghijklmnop',
    RawResponse: 'private' } };
const expected = { transactionId: 'hosted-1', amountMinor: 11800, register: '004',
  confirmationKey: 'synthetic-confirmation',
  merchantTerminal: '1234567890', deviceDetails: { StatusCode: '000', Uid: 'uid-1',
    termNo: '004', Amount: '11800', retailer: '1234567890' } };

test('hosted EMV request uses frozen gross lines, VAT and register 004', () => {
  const request = buildHostedEmvRequest(base, credentials, {
    goodUrl: 'https://example.test/return', errorUrl: 'https://example.test/return',
    callbackUrl: 'https://example.test/callback' });
  assert.equal(request.ShopNo, '004');
  assert.equal(request.EmvPinpad, 'True');
  assert.equal(request.Total, '11800');
  assert.deepEqual(request.PayperParameters.DataPayper.invoice_lines, [{
    description: 'Group climbing', quantity: '2', price_per_unit: '5900',
    include_vat: 'true', no_vat: 'false', currency_symbol: 'ILS' }]);
  assert.deepEqual(request.PayperParameters.DataPayper.receipt_lines, []);
  assert.equal(request.PayperParameters.DataPayper.document_no_vat, 'false');
});
test('scheduled balance uses the frozen order line and explicit VAT decision', () => {
  const intent = { ...base, checkoutSnapshot: { items: [{ name: 'Group activity — ORD-SYN',
    qty: 1, customPrice: 118 }], discount: null, source_order: { orderId: id } },
    billingSnapshot: { ...base.billingSnapshot, vatApplicable: false } };
  const request = buildHostedEmvRequest(intent, credentials, {
    goodUrl: 'https://example.test/return', errorUrl: 'https://example.test/return',
    callbackUrl: 'https://example.test/callback' });
  assert.equal(request.PayperParameters.DataPayper.document_no_vat, 'true');
  assert.equal(request.PayperParameters.DataPayper.invoice_lines[0].price_per_unit, '11800');
});
test('hosted builder rejects another register, invalid billing, VAT and mismatched total', () => {
  for (const change of [{ register: '003' }, { amountMinor: 11799 },
    { billingSnapshot: { ...base.billingSnapshot, identity: 'invalid' } },
    { billingSnapshot: { ...base.billingSnapshot, identity: '123456789' } },
    { billingSnapshot: { ...base.billingSnapshot, vatApplicable: null } }])
    assert.throws(() => buildHostedEmvRequest({ ...base, ...change }, credentials, {
      goodUrl: 'https://example.test/return', errorUrl: 'https://example.test/return',
      callbackUrl: 'https://example.test/callback' }));
});
test('payment approval is independent of Payper invoice outcome', () => {
  const approved = classifyHostedEmvResult(result, expected);
  assert.equal(approved.paymentState, 'approved');
  assert.equal(approved.document.state, 'succeeded');
  assert.equal(approved.document.number, '595170');
  assert.ok(!JSON.stringify(approved).includes('private'));
  for (const data of [{ InvoiceStatus: 'Error' }, undefined]) {
    const classified = classifyHostedEmvResult({ ...result, PayperData: data },
      expected);
    assert.equal(classified.paymentState, 'approved');
    assert.equal(classified.document.state, 'reconciliation_required');
  }
});
test('ambiguous result, amount mismatch and duplicate document identity cannot count as approved invoice', () => {
  for (const response of [{ ...result, StatusCode: '111' },
    { ...result, ResultData: { ...result.ResultData, DebitTotal: '11799' } },
    { ...result, ResultData: { ...result.ResultData, ShvaResultEmv: '002' } }])
    assert.equal(classifyHostedEmvResult(response, expected)
      .paymentState, 'uncertain');
  assert.equal(classifyHostedEmvResult(result, { ...expected, deviceDetails: {
    ...expected.deviceDetails, termNo: '003' } }).paymentState, 'uncertain');
  assert.equal(parseHostedPayperData({ ...result.PayperData, InvoiceNumber: '595171' }).state,
    'reconciliation_required');
  assert.equal(parseHostedPayperData({ ...result.PayperData, InvoiceStatus: 'Success' }).state,
    'reconciliation_required');
});
