import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalPelecardProvider } from './provider.js';

const source = { id: 'intent-1', register: '004', amountMinor: 1500,
  checkoutSnapshot: { items: [{ name: 'Synthetic order', qty: 1, customPrice: 15 }], discount: null },
  billingSnapshot: { kind: 'person', name: 'Synthetic Customer', identity: '123456782',
    email: 'synthetic@example.test', vatApplicable: true } };

test('J4 includes Payper only when the separate direct invoice gate is enabled', async () => {
  const bodies = [];
  const fetcher = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ StatusCode: '000', DebitTotal: '1500',
      PayperData: { InvoiceStatus: 'Success', InvoiceNumber: '595170',
        InvoiceLink: 'https://app.payper.co.il/public/invoice_show/595170?ak=abcdefghijklmnop' } }));
  };
  const provider = createPhysicalPelecardProvider({ terminalNumber: '2814926015',
    user: 'synthetic', password: 'synthetic', fetcher });
  const args = { merchantTerminal: '2814926015', register: '004', amountMinor: 1500,
    intentId: 'intent-1', uidRecoveryEnabled: true };
  const off = await provider.send(args);
  assert.equal(bodies[0].PayperParameters, undefined);
  assert.equal(off.firstResponse.document.state, 'succeeded');
  await provider.send({ ...args, payperSource: source });
  assert.equal(bodies[1].PayperParameters.typeDocument, 'Invoice-Receipt');
  assert.equal(bodies[1].PayperParameters.DataPayper.invoice_lines[0].price_per_unit, '1500');
});

test('read-only J4 lookup reports a safe nonfinal status without sending a debit', async () => {
  const urls = [];
  const fetcher = async url => {
    urls.push(url);
    return new Response(JSON.stringify({ StatusCode: '510', UserData: [] }));
  };
  const provider = createPhysicalPelecardProvider({ terminalNumber: '2814926015',
    user: 'synthetic', password: 'synthetic', fetcher });
  await assert.rejects(provider.inspect({ id: 'intent-1', register: '004', amountMinor: 1500 }),
    /physical_result_unverified_510_0/);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /CheckGoodParamXEMV$/);
});

test('saved successful J4 response is confirmed by UID details without another debit', async () => {
  const urls = [];
  const provider = createPhysicalPelecardProvider({ terminalNumber: '2814926015',
    user: 'synthetic', password: 'synthetic', fetcher: async url => {
      urls.push(url);
      return new Response(JSON.stringify({ StatusCode: '000', ResultData: {
        UID: 'uid-1', termNo: '004', Amount: '1500', retailer: '2814926015',
        PelecardTransactionId: 'trx-1', DebitApproveNumber: 'auth-1', ShvaResult: '000',
      } }));
    } });
  const intent = { id: '833db2d6-18b1-4d66-bbcd-4360b95a315c', register: '004',
    amountMinor: 1500, uidRecoveryEnabled: true };
  const firstResponse = { payment: { statusCode: '000', shvaResult: '000', shvaResultEmv: '000',
    amountMinor: 1500, currency: '1', paramX: (await import('./reference.js')).directParamX(intent.id),
    uid: 'uid-1', transactionId: 'trx-1', approvalId: 'auth-1' } };
  assert.deepEqual(await provider.confirmFirstResponse(intent, firstResponse), {
    status: 'approved', intentId: intent.id, merchantTerminal: '2814926015',
    register: '004', amountMinor: 1500, transactionId: 'trx-1', approvalId: 'auth-1', uid: 'uid-1',
  });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /GetTransDetailsEMV$/);
});

test('UID confirmation rejects missing register correlation', async () => {
  const provider = createPhysicalPelecardProvider({ terminalNumber: '2814926015',
    user: 'synthetic', password: 'synthetic', fetcher: async () =>
      new Response(JSON.stringify({ StatusCode: '000', ResultData: {
        UID: 'uid-1', termNo: '003', Amount: '1500', retailer: '2814926015',
      } })) });
  await assert.rejects(provider.confirmFirstResponse({ id: 'intent-1', register: '004', amountMinor: 1500 },
    { payment: { statusCode: '000', shvaResult: '000', shvaResultEmv: '000',
      amountMinor: 1500, currency: '1', paramX: 'intent-1', uid: 'uid-1',
      transactionId: 'trx-1', approvalId: 'auth-1' } }), /physical_result_unverified/);
});

test('new J4 sends a 19-character ParamX and recovery looks up the same reference', async () => {
  const references = [];
  const provider = createPhysicalPelecardProvider({ terminalNumber: '2814926015',
    user: 'synthetic', password: 'synthetic', fetcher: async (url, options) => {
      const body = JSON.parse(options.body);
      if (url.endsWith('DebitRegularType')) {
        references.push(body.paramX);
        return new Response(JSON.stringify({ StatusCode: '000', ResultData: {
          StatusCode: '000', ShvaResult: '000', ShvaResultEmv: '000',
          PelecardTransactionId: 'trx-1', UID: 'uid-1', DebitApproveNumber: 'auth-1',
          DebitTotal: '1500', DebitCurrency: '1', AdditionalDetailsParamX: body.paramX,
        } }));
      }
      if (url.endsWith('CheckGoodParamXEMV')) {
        references.push(body.paramX);
        return new Response(JSON.stringify({ StatusCode: '000', UserData: [{
          TerminalNumber: '2814926015', DebitTotal: '1500',
          AdditionalDetailsParamX: body.paramX, ShvaResult: '000',
          PelecardTransactionId: 'trx-1', UID: 'uid-1', DebitApproveNumber: 'auth-1',
        }] }));
      }
      return new Response(JSON.stringify({ StatusCode: '000', ResultData: {
        UID: 'uid-1', termNo: '004', Amount: '1500', retailer: '2814926015',
      } }));
    } });
  const id = '833db2d6-18b1-4d66-bbcd-4360b95a315c';
  await provider.send({ merchantTerminal: '2814926015', register: '004',
    amountMinor: 1500, intentId: id, uidRecoveryEnabled: true });
  const result = await provider.inspect({ id, register: '004', amountMinor: 1500,
    uidRecoveryEnabled: true });
  assert.equal(result.status, 'approved');
  assert.equal(references.length, 2);
  assert.equal(references[0], references[1]);
  assert.equal(references[0].length, 19);
  assert.notEqual(references[0], id);
});
