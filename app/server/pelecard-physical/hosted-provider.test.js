import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostedEmvProvider } from './hosted-provider.js';

const id = '11111111-1111-4111-8111-111111111111';
const intent = { id, register: '004', amountMinor: 11800,
  checkoutSnapshot: { items: [{ name: 'Synthetic activity', qty: 1, customPrice: 118 }], discount: null },
  billingSnapshot: { kind: 'person', name: 'Synthetic Customer', identity: '123456782',
    email: 'synthetic@example.test', vatApplicable: true } };
const credentials = { terminal: '1234567890', user: 'synthetic-user', password: 'synthetic-secret' };
const urls = { goodUrl: 'https://example.test/return', errorUrl: 'https://example.test/return',
  callbackUrl: 'https://example.test/callback' };
const hostedId = '22222222-2222-4222-8222-222222222222';
test('initialization creates only a hosted session and returns a validated URL', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options });
    return new Response(JSON.stringify({ URL: `https://gateway21.pelecard.biz/PaymentGW?transactionId=${hostedId}`,
      TransactionId: hostedId, ConfirmationKey: 'synthetic-confirmation' })); };
  const provider = createHostedEmvProvider(credentials, fetcher);
  const session = await provider.initialize(intent, urls);
  assert.equal(session.transactionId, hostedId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://gateway21.pelecard.biz/PaymentGW/init');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.EmvPinpad, 'True');
  assert.equal(body.ShopNo, '004');
  assert.equal(body.Total, '11800');
});
test('invalid redirect, duplicate session mismatch and transport ambiguity cannot produce a session', async () => {
  for (const response of [
    { URL: `https://evil.example/PaymentGW?transactionId=${hostedId}`, TransactionId: hostedId,
      ConfirmationKey: 'synthetic-confirmation' },
    { URL: `https://gateway21.pelecard.biz/PaymentGW?transactionId=${hostedId}`,
      TransactionId: id, ConfirmationKey: 'synthetic-confirmation' },
  ]) await assert.rejects(createHostedEmvProvider(credentials, async () =>
    new Response(JSON.stringify(response))).initialize(intent, urls));
  await assert.rejects(createHostedEmvProvider(credentials, async () => {
    throw Error('transport'); }).initialize(intent, urls));
});
test('GetTransaction lookup only projects financial fields; it does not infer a Payper document', async () => {
  const provider = createHostedEmvProvider(credentials, async (url, options) => {
    assert.equal(url, 'https://gateway21.pelecard.biz/PaymentGW/GetTransaction');
    assert.equal(JSON.parse(options.body).TransactionId, hostedId);
    return new Response(JSON.stringify({ StatusCode: '000', ResultData: {
      TransactionId: hostedId, ShvaResult: '000', ShvaResultEmv: '000', DebitTotal: '11800',
      DebitCurrency: '1', Uid: 'uid-1', TransactionPelecardId: '1234', DebitApproveNumber: '1234',
      CreditCardNumber: 'sensitive-card' }, PayperData: { InvoiceStatus: '000',
      InvoiceNumber: '595170', InvoiceLink: 'https://app.payper.co.il/public/invoice_show/595170' } }));
  });
  const response = await provider.lookup(hostedId);
  assert.equal(response.ResultData.DebitTotal, '11800');
  assert.equal(response.PayperData, undefined);
  assert.ok(!JSON.stringify(response).includes('sensitive-card'));
});
