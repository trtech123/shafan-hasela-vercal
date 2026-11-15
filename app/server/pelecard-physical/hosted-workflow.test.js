import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalWorkflow } from './workflow.js';

const id = '11111111-1111-4111-8111-111111111111';
const transactionId = '22222222-2222-4222-8222-222222222222';
const intent = { id, state: 'reserved', route: 'direct', register: '004', amountMinor: 11800,
  merchantTerminal: '2814926015', checkoutSnapshot: { items: [{ name: 'Synthetic', qty: 1,
    customPrice: 118 }], discount: null }, billingSnapshot: { kind: 'person',
    name: 'Synthetic Customer', identity: '123456782', email: 'synthetic@example.test',
    vatApplicable: true } };
const session = { transactionId, confirmationKey: 'synthetic-confirmation',
  redirectUrl: `https://gateway21.pelecard.biz/PaymentGW?transactionId=${transactionId}` };
const response = { StatusCode: '000', ResultData: { TransactionId: transactionId,
  TransactionPelecardId: '12345', ConfirmationKey: session.confirmationKey,
  DebitTotal: '11800', DebitCurrency: '1', ShvaResult: '000', ShvaResultEmv: '000',
  Uid: 'uid-1', DebitApproveNumber: '123456' }, PayperData: { InvoiceStatus: '000',
  InvoiceNumber: '595170', InvoiceLink: 'https://app.payper.co.il/public/invoice_show/595170' } };
function setup() {
  const calls = [];
  let row = { ...intent };
  let ledger = 'source_blocked';
  const deps = { merchantTerminal: intent.merchantTerminal, enabled: true,
    hostedEnabled: true, hostedInitEnabled: true,
    hostedUrls: { goodUrl: 'https://example.test/return', errorUrl: 'https://example.test/return',
      callbackBase: 'https://example.test/api/pelecard-physical-callback' },
    status: async () => row,
    claimHostedInit: async () => { calls.push('claim'); if (row.state !== 'reserved') return false;
      row = { ...row, route: 'hosted', state: 'dispatching' }; return true; },
    hostedSource: async () => row,
    persistHostedSession: async (_id, saved) => { calls.push('persist'); row = { ...row,
      state: 'pending', hostedTransactionId: saved.transactionId,
      hostedConfirmationKey: saved.confirmationKey }; },
    markUncertain: async () => { calls.push('uncertain'); row = { ...row, state: 'uncertain' }; },
    hostedProvider: { initialize: async () => { calls.push('init'); return session; },
      lookup: async () => { calls.push('lookup'); return response; } },
    provider: { getTransactionDetailsByUid: async () => ({ StatusCode: '000', Uid: 'uid-1',
      termNo: '004', Amount: '11800', retailer: intent.merchantTerminal }) },
    finalize: async () => { calls.push('finalize'); row = { ...row, state: 'succeeded' };
      return { saleId: '33333333-3333-4333-8333-333333333333' }; },
    hostedDocumentState: async () => ledger,
    recordHostedDocument: async () => { calls.push('document'); ledger = 'succeeded'; },
  };
  return { deps, calls, setResponse(value) { deps.hostedProvider.lookup = async () => value; },
    getRow: () => row, getLedger: () => ledger };
}
test('hosted initialization is claimed once and never sends a card charge', async () => {
  const s = setup();
  const workflow = createPhysicalWorkflow(s.deps);
  assert.equal((await workflow.openHosted(id)).redirectUrl, session.redirectUrl);
  assert.deepEqual(s.calls, ['claim', 'init', 'persist']);
  await workflow.openHosted(id);
  assert.deepEqual(s.calls, ['claim', 'init', 'persist']);
});
test('verified hosted payment finalizes once and records one existing Payper document', async () => {
  const s = setup(); const workflow = createPhysicalWorkflow(s.deps);
  await workflow.openHosted(id);
  assert.equal((await workflow.verify(id)).state, 'succeeded');
  assert.equal(s.getLedger(), 'succeeded');
  await workflow.verify(id);
  assert.equal(s.calls.filter(value => value === 'finalize').length, 1);
  assert.equal(s.calls.filter(value => value === 'document').length, 1);
});
test('approved payment with invoice error remains paid with reconciliation hold', async () => {
  const s = setup(); const workflow = createPhysicalWorkflow(s.deps);
  await workflow.openHosted(id);
  s.setResponse({ ...response, PayperData: { InvoiceStatus: 'Error' } });
  assert.equal((await workflow.verify(id)).state, 'succeeded');
  assert.equal(s.getLedger(), 'source_blocked');
  assert.equal(s.calls.filter(value => value === 'finalize').length, 1);
  assert.equal(s.calls.includes('document'), false);
});
test('ambiguous hosted result and register mismatch cannot finalize', async () => {
  for (const changed of [{ ...response, ResultData: { ...response.ResultData, DebitTotal: '11799' } },
    { ...response, ResultData: { ...response.ResultData, ConfirmationKey: 'wrong' } }]) {
    const s = setup(); const workflow = createPhysicalWorkflow(s.deps);
    await workflow.openHosted(id); s.setResponse(changed);
    assert.equal((await workflow.verify(id)).state, 'uncertain');
    assert.equal(s.calls.includes('finalize'), false);
  }
});
test('the preserved direct J4 worker refuses a hosted intent', async () => {
  const s = setup(); const workflow = createPhysicalWorkflow(s.deps);
  await workflow.openHosted(id);
  s.deps.dispatchEnabled = true;
  await assert.rejects(workflow.dispatch(id), /physical_direct_route_required/);
  assert.equal(s.calls.includes('send'), false);
});
