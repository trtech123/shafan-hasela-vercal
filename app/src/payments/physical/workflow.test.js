import { describe, expect, test, vi } from 'vitest';
import { createPhysicalWorkflow } from '../../../server/pelecard-physical/workflow.js';

const cart = { lines: [{ kind: 'product', id: 'p1', qty: 2 }] };
function dependencies(overrides = {}) {
  const intent = { id: 'intent-1', amountMinor: 2400, register: '003', state: 'reserved' };
  return {
    enabled: true,
    dispatchEnabled: true,
    registerForWorkstation: vi.fn(async () => '003'),
    calculateCart: vi.fn(async () => ({ amountMinor: 2400, items: [{ id: 'p1', qty: 2, unitMinor: 1200 }] })),
    reserve: vi.fn(async () => intent),
    claimDispatch: vi.fn(async () => true),
    markDispatched: vi.fn(async () => {}),
    markUncertain: vi.fn(async () => {}),
    markDeclined: vi.fn(async () => {}),
    status: vi.fn(async () => ({ ...intent, state: 'pending' })),
    merchantTerminal: '2814926015',
    provider: { send: vi.fn(async () => ({ requestId: 'provider-1' })), inspect: vi.fn(async () => ({ status: 'approved', intentId: 'intent-1', merchantTerminal: '2814926015', amountMinor: 2400, register: '003', transactionId: 'trx-1', approvalId: 'ok' })) },
    finalize: vi.fn(async () => ({ saleId: 'sale-1', documentState: 'eligible' })),
    finishApproved: vi.fn(async () => ({ saleId: 'sale-1', documentState: 'eligible' })),
    ...overrides,
  };
}

describe('physical terminal workflow', () => {
  test('disabled by default and never dispatches', async () => {
    const deps = dependencies({ enabled: false });
    await expect(createPhysicalWorkflow(deps).start({ workstationId: 'w1', requestKey: 'key-1', cart })).rejects.toThrow('physical_disabled');
    expect(deps.provider.send).not.toHaveBeenCalled();
  });
  test('financial dispatch requires its own explicit gate', async () => {
    const deps = dependencies({ dispatchEnabled: false });
    await expect(createPhysicalWorkflow(deps).dispatch('intent-1')).rejects.toThrow('physical_dispatch_disabled');
    expect(deps.claimDispatch).not.toHaveBeenCalled();
    expect(deps.provider.send).not.toHaveBeenCalled();
  });
  test('reserves server-calculated amount without waiting for device response', async () => {
    const deps = dependencies();
    const result = await createPhysicalWorkflow(deps).start({ workstationId: 'w1', requestKey: 'key-1', cart, amountMinor: 1, register: '006' });
    expect(deps.reserve).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 2400, register: '003' }));
    expect(deps.provider.send).not.toHaveBeenCalled();
    expect(result.state).toBe('reserved');
    await createPhysicalWorkflow(deps).dispatch(result.id);
    expect(deps.provider.send).toHaveBeenCalledWith({
      amountMinor: 2400, register: '003', merchantTerminal: '2814926015', intentId: 'intent-1',
    });
    expect(deps.finalize).not.toHaveBeenCalled();
  });
  test('same request never dispatches twice', async () => {
    const deps = dependencies();
    deps.claimDispatch.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const workflow = createPhysicalWorkflow(deps);
    await workflow.start({ workstationId: 'w1', requestKey: 'key-1', cart });
    await workflow.dispatch('intent-1');
    await workflow.dispatch('intent-1');
    expect(deps.provider.send).toHaveBeenCalledTimes(1);
  });
  test('busy device is held without dispatch', async () => {
    const deps = dependencies({ claimDispatch: vi.fn(async () => false) });
    const result = await createPhysicalWorkflow(deps).dispatch('intent-1');
    expect(result.state).toBe('pending');
    expect(deps.provider.send).not.toHaveBeenCalled();
  });
  test('transport timeout stays uncertain and never retries', async () => {
    const deps = dependencies();
    deps.provider.send.mockRejectedValue(new Error('offline'));
    const result = await createPhysicalWorkflow(deps).dispatch('intent-1');
    expect(result.state).toBe('uncertain');
    expect(deps.markUncertain).toHaveBeenCalledWith('intent-1');
    expect(deps.provider.send).toHaveBeenCalledTimes(1);
    expect(deps.finalize).not.toHaveBeenCalled();
  });
  test('authoritative decline releases the device without creating a sale', async () => {
    const deps = dependencies({ markDeclined: vi.fn(async () => ({ state: 'declined' })) });
    deps.provider.inspect.mockResolvedValue({ status: 'declined', intentId: 'intent-1', merchantTerminal: '2814926015', register: '003', amountMinor: 2400, transactionId: 'trx-1' });
    const result = await createPhysicalWorkflow(deps).verify('intent-1');
    expect(result.state).toBe('declined');
    expect(deps.markDeclined).toHaveBeenCalledWith('intent-1', expect.objectContaining({ transactionId: 'trx-1' }));
    expect(deps.finalize).not.toHaveBeenCalled();
  });
  test('a decline without full correlation remains uncertain', async () => {
    const deps = dependencies({ markDeclined: vi.fn() });
    deps.provider.inspect.mockResolvedValue({ status: 'declined', intentId: 'intent-1', merchantTerminal: '2814926015', register: '006', amountMinor: 2400, transactionId: 'trx-1' });
    expect((await createPhysicalWorkflow(deps).verify('intent-1')).state).toBe('uncertain');
    expect(deps.markDeclined).not.toHaveBeenCalled();
  });
  test('only verified matching approval finalizes one sale', async () => {
    const deps = dependencies();
    const workflow = createPhysicalWorkflow(deps);
    const verified = await workflow.verify('intent-1');
    expect(deps.provider.inspect).toHaveBeenCalledWith(expect.objectContaining({ id: 'intent-1', register: '003', amountMinor: 2400 }));
    expect(deps.finalize).toHaveBeenCalledWith('intent-1', expect.objectContaining({ transactionId: 'trx-1', amountMinor: 2400 }));
    expect(verified).toMatchObject({ saleId: 'sale-1', documentState: 'eligible' });
  });
  test('repeated status checks return the existing sale without a second finalization', async () => {
    const deps = dependencies();
    const originalFinalize = deps.finalize;
    deps.finalize = vi.fn(async (...args) => {
      const result = await originalFinalize(...args);
      deps.status.mockResolvedValue({ id: 'intent-1', state: 'succeeded', saleId: result.saleId });
      return result;
    });
    const workflow = createPhysicalWorkflow(deps);
    const first = await workflow.verify('intent-1');
    const second = await workflow.verify('intent-1');
    expect(first.saleId).toBe('sale-1');
    expect(second.saleId).toBe('sale-1');
    expect(deps.finalize).toHaveBeenCalledTimes(1);
  });
  test('lookup failure leaves the outcome uncertain and creates no sale', async () => {
    const deps = dependencies();
    deps.provider.inspect.mockRejectedValue(new Error('offline'));
    const result = await createPhysicalWorkflow(deps).verify('intent-1');
    expect(result.state).toBe('uncertain');
    expect(deps.finalize).not.toHaveBeenCalled();
  });
  test('recovers a persisted approval after worker interruption without repeating provider lookup', async () => {
    const deps = dependencies({ status: vi.fn(async () => ({
      id: 'intent-1', amountMinor: 2400, register: '003', state: 'approved',
    })) });
    const result = await createPhysicalWorkflow(deps).verify('intent-1');
    expect(result).toMatchObject({ state: 'succeeded', saleId: 'sale-1' });
    expect(deps.finishApproved).toHaveBeenCalledWith('intent-1');
    expect(deps.provider.inspect).not.toHaveBeenCalled();
  });
  test('a reserved intent cannot be verified before dispatch', async () => {
    const deps = dependencies({ status: vi.fn(async () => ({
      id: 'intent-1', amountMinor: 2400, register: '003', state: 'reserved',
    })) });
    const result = await createPhysicalWorkflow(deps).verify('intent-1');
    expect(result.state).toBe('reserved');
    expect(deps.provider.inspect).not.toHaveBeenCalled();
  });
  test('an interrupted dispatch can be inspected and remains locked if lookup fails', async () => {
    const deps = dependencies({ status: vi.fn(async () => ({
      id: 'intent-1', amountMinor: 2400, register: '003', state: 'dispatching',
    })) });
    deps.provider.inspect.mockRejectedValue(new Error('offline'));
    expect((await createPhysicalWorkflow(deps).verify('intent-1')).state).toBe('uncertain');
    expect(deps.markUncertain).toHaveBeenCalledWith('intent-1');
  });
  test.each([{ amountMinor: 1 }, { register: '006' }, { merchantTerminal: 'other' }, { intentId: 'other' }, { status: 'declined' }, { transactionId: '' }])('mismatched or unapproved result cannot finalize: %j', async patch => {
    const deps = dependencies();
    deps.provider.inspect.mockResolvedValue({ status: 'approved', intentId: 'intent-1', merchantTerminal: '2814926015', amountMinor: 2400, register: '003', transactionId: 'trx-1', approvalId: 'ok', ...patch });
    await createPhysicalWorkflow(deps).verify('intent-1');
    expect(deps.finalize).not.toHaveBeenCalled();
  });
});
