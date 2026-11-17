import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalWorkflow } from './workflow.js';

const intent = { id: 'intent-1', state: 'reserved', route: 'direct', register: '004', amountMinor: 1500 };
const approved = { status: 'approved', intentId: 'intent-1', merchantTerminal: '2814926015',
  register: '004', amountMinor: 1500, transactionId: 'trx-1', approvalId: 'auth-1', uid: 'uid-1' };
const firstResponse = { payment: { transactionId: 'trx-1', amountMinor: 1500 },
  document: { state: 'succeeded', number: '595170',
    url: 'https://app.payper.co.il/public/invoice_show/595170?ak=abcdefghijklmnop',
    systemId: '595170', documentId: '550' } };

test('dispatch persists the first response before marking pending', async () => {
  const events = [];
  const workflow = createPhysicalWorkflow({ enabled: true, dispatchEnabled: true,
    payperEnabled: true, merchantTerminal: '2814926015', status: async () => intent,
    claimDispatch: async () => true, directSource: async () => ({ ...intent,
      checkoutSnapshot: {}, billingSnapshot: {} }),
    provider: { send: async request => { assert.equal(request.payperSource.id, intent.id);
      events.push('send'); return { firstResponse }; } },
    persistFirstResponse: async (_id, response) => {
      assert.deepEqual(response, firstResponse); events.push('persist'); },
    markDispatched: async () => events.push('pending') });
  assert.deepEqual(await workflow.dispatch(intent.id), { id: intent.id, state: 'pending' });
  assert.deepEqual(events, ['send', 'persist', 'pending']);
});
test('worker refuses a non-accepted order before claiming or sending J4', async () => {
  let claimed = false;
  const workflow = createPhysicalWorkflow({ enabled: true, dispatchEnabled: true,
    acceptanceOrderId: '44444444-4444-4444-8444-444444444444',
    acceptanceAmountMinor: 1500, merchantTerminal: '2814926015', status: async () => intent,
    orderForIntent: async () => '55555555-5555-4555-8555-555555555555',
    claimDispatch: async () => { claimed = true; return true; },
    provider: { send: async () => { throw Error('must not send'); } },
    markUncertain: async () => {} });
  await assert.rejects(workflow.dispatch(intent.id), /physical_acceptance_scope_invalid/);
  assert.equal(claimed, false);
});
test('controlled acceptance cannot reserve a standalone cart or a different order', async () => {
  let reservations = 0;
  const workflow = createPhysicalWorkflow({ enabled: true,
    acceptanceOrderId: '44444444-4444-4444-8444-444444444444',
    acceptanceAmountMinor: 1500, merchantTerminal: '2814926015',
    registerForWorkstation: async () => '004',
    reserveOrder: async () => { reservations++; return intent; },
    reserve: async () => { reservations++; return intent; } });
  const base = { actorId: 'actor-1', actorRole: 'cashier',
    workstationId: 'GENERAL', requestKey: 'request-1' };
  await assert.rejects(workflow.startOrder({ ...base,
    orderId: '55555555-5555-4555-8555-555555555555', amountMinor: 1500 }),
  /physical_acceptance_scope_invalid/);
  await assert.rejects(workflow.startOrder({ ...base,
    orderId: '44444444-4444-4444-8444-444444444444', amountMinor: 1400 }),
  /physical_acceptance_scope_invalid/);
  await assert.rejects(workflow.start({ ...base, cart: {}, billing: {} }),
    /physical_acceptance_scope_invalid/);
  assert.equal(reservations, 0);
});

test('lost provider response stays uncertain and recovery never sends again', async () => {
  let sends = 0;
  const workflow = createPhysicalWorkflow({ enabled: true, dispatchEnabled: true,
    merchantTerminal: '2814926015', status: async () => ({ ...intent, state: 'dispatching' }),
    claimDispatch: async () => true, provider: { send: async () => { sends++; throw Error('timeout'); },
      inspect: async () => { throw Error('not yet visible'); } },
    markUncertain: async () => {} });
  assert.equal((await workflow.dispatch(intent.id)).state, 'uncertain');
  assert.equal((await workflow.verify(intent.id)).state, 'uncertain');
  assert.equal(sends, 1);
});

test('verified payment associates the saved first-response invoice with its sale', async () => {
  const events = [];
  const workflow = createPhysicalWorkflow({ merchantTerminal: '2814926015',
    status: async () => ({ ...intent, state: 'pending', firstResponse }),
    provider: { inspect: async () => approved }, finalize: async () => {
      events.push('sale'); return { saleId: 'sale-1' }; },
    recordDirectDocument: async (_id, document) => {
      assert.equal(document.number, '595170'); events.push('invoice'); } });
  const result = await workflow.verify(intent.id);
  assert.equal(result.state, 'succeeded');
  assert.equal(result.documentState, 'succeeded');
  assert.deepEqual(events, ['sale', 'invoice']);
});

test('approved payment with failed invoice keeps the sale and requires reconciliation', async () => {
  const workflow = createPhysicalWorkflow({ merchantTerminal: '2814926015',
    status: async () => ({ ...intent, state: 'pending', firstResponse: {
      ...firstResponse, document: { state: 'reconciliation_required', status: 'Error' } } }),
    provider: { inspect: async () => approved }, finalize: async () => ({ saleId: 'sale-1' }),
    recordDirectDocument: async () => { throw Error('must not issue'); } });
  const result = await workflow.verify(intent.id);
  assert.equal(result.state, 'succeeded');
  assert.equal(result.documentState, 'reconciliation_required');
});

test('worker restart associates a saved invoice after the sale was finalized', async () => {
  let associations = 0;
  const workflow = createPhysicalWorkflow({ merchantTerminal: '2814926015',
    status: async () => ({ ...intent, state: 'succeeded', transactionId: 'trx-1',
      saleId: 'sale-1', documentState: 'source_blocked', firstResponse }),
    provider: { send: async () => { throw Error('must not send'); },
      inspect: async () => { throw Error('must not lookup'); } },
    recordDirectDocument: async () => { associations++; } });
  const result = await workflow.verify(intent.id);
  assert.equal(result.documentState, 'succeeded');
  assert.equal(associations, 1);
});
