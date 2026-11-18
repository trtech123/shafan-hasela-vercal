import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalWorkflow } from './workflow.js';

const intent = { id: 'intent-1', state: 'reserved', route: 'direct', register: '004',
  amountMinor: 1500, uidRecoveryEnabled: true };
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

test('new J4 dispatch confirms saved response by UID and links one sale and invoice', async () => {
  const events = [];
  const workflow = createPhysicalWorkflow({ enabled: true, dispatchEnabled: true,
    payperEnabled: true, merchantTerminal: '2814926015', status: async () => intent,
    claimDispatch: async () => true, directSource: async () => ({ ...intent }),
    provider: { send: async () => { events.push('send'); return { firstResponse }; },
      confirmFirstResponse: async (saved, response) => {
        assert.equal(saved.id, intent.id); assert.deepEqual(response, firstResponse);
        events.push('confirm'); return approved;
      } },
    persistFirstResponse: async () => events.push('persist'),
    markDispatched: async () => events.push('pending'),
    finalize: async () => { events.push('sale'); return { saleId: 'sale-1' }; },
    recordDirectDocument: async () => events.push('invoice') });
  const result = await workflow.dispatch(intent.id);
  assert.equal(result.state, 'succeeded');
  assert.equal(result.documentState, 'succeeded');
  assert.deepEqual(events, ['send', 'persist', 'pending', 'confirm', 'sale', 'invoice']);
});

test('unverifiable new J4 response is retained as uncertain and never sent twice', async () => {
  let sends = 0;
  const workflow = createPhysicalWorkflow({ enabled: true, dispatchEnabled: true,
    merchantTerminal: '2814926015', status: async () => intent,
    claimDispatch: async () => true,
    provider: { send: async () => { sends++; return { firstResponse }; },
      confirmFirstResponse: async () => { throw Error('physical_result_unverified'); } },
    persistFirstResponse: async () => {}, markDispatched: async () => {},
    markUncertain: async () => {} });
  assert.equal((await workflow.dispatch(intent.id)).state, 'uncertain');
  assert.equal(sends, 1);
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

test('unresolved recovery reports only a sanitized provider code and never resends J4', async () => {
  const warnings = [];
  let sends = 0;
  const workflow = createPhysicalWorkflow({ merchantTerminal: '2814926015',
    status: async () => ({ ...intent, state: 'uncertain' }),
    provider: { send: async () => { sends++; },
      inspect: async () => { throw Error('physical_result_unverified_510_0'); } },
    markUncertain: async () => {},
    logDiagnostic: (event, detail) => warnings.push({ event, detail }) });
  assert.equal((await workflow.verify(intent.id)).state, 'uncertain');
  assert.equal(sends, 0);
  assert.deepEqual(warnings, [{ event: 'physical_provider_inspection_unresolved',
    detail: { paymentId: intent.id, reason: 'physical_result_unverified_510_0' } }]);
});

test('worker interruption recovers a new saved J4 response by UID without resending', async () => {
  const events = [];
  const workflow = createPhysicalWorkflow({ merchantTerminal: '2814926015',
    status: async () => ({ ...intent, state: 'uncertain', uidRecoveryEnabled: true, firstResponse }),
    provider: { inspect: async () => { throw Error('physical_result_unverified_000_0'); },
      confirmFirstResponse: async () => { events.push('uid'); return approved; },
      send: async () => { throw Error('must not send'); } },
    finalize: async () => { events.push('sale'); return { saleId: 'sale-1' }; },
    recordDirectDocument: async () => { events.push('invoice'); },
    markUncertain: async () => { throw Error('must not mark uncertain'); } });
  const result = await workflow.verify(intent.id);
  assert.equal(result.state, 'succeeded');
  assert.equal(result.documentState, 'succeeded');
  assert.deepEqual(events, ['uid', 'sale', 'invoice']);
});

test('pre-migration unresolved attempt is never auto-finalized from its saved response', async () => {
  let uidChecks = 0;
  const workflow = createPhysicalWorkflow({ merchantTerminal: '2814926015',
    status: async () => ({ ...intent, state: 'uncertain',
      uidRecoveryEnabled: false, firstResponse }),
    provider: { inspect: async () => { throw Error('physical_result_unverified_000_0'); },
      confirmFirstResponse: async () => { uidChecks++; return approved; } },
    markUncertain: async () => {} });
  assert.equal((await workflow.verify(intent.id)).state, 'uncertain');
  assert.equal(uidChecks, 0);
});

test('pre-migration reserved intent cannot dispatch with the new ParamX format', async () => {
  let claims = 0;
  const workflow = createPhysicalWorkflow({ enabled: true, dispatchEnabled: true,
    merchantTerminal: '2814926015',
    status: async () => ({ ...intent, uidRecoveryEnabled: false }),
    claimDispatch: async () => { claims++; return true; },
    provider: { send: async () => { throw Error('must not charge'); } } });
  await assert.rejects(workflow.dispatch(intent.id), /physical_direct_schema_required/);
  assert.equal(claims, 0);
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
