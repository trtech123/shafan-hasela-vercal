import { describe, expect, test, vi } from 'vitest';
import { createPhysicalWorkflow } from '../../../server/pelecard-physical/workflow.js';

const cart = { lines: [{ kind: 'product', id: 'p1', qty: 2 }] };
function dependencies(overrides = {}) {
  const intent = { id: 'intent-1', amountMinor: 2400, register: '003', state: 'reserved' };
  return {
    enabled: true,
    registerForWorkstation: vi.fn(async () => '003'),
    calculateCart: vi.fn(async () => ({ amountMinor: 2400, items: [{ id: 'p1', qty: 2, unitMinor: 1200 }] })),
    reserve: vi.fn(async () => intent),
    claimDispatch: vi.fn(async () => true),
    markDispatched: vi.fn(async () => {}),
    markUncertain: vi.fn(async () => {}),
    status: vi.fn(async () => intent),
    provider: { send: vi.fn(async () => ({ requestId: 'provider-1' })), inspect: vi.fn(async () => ({ status: 'approved', intentId: 'intent-1', merchantTerminal: '2814926', amountMinor: 2400, register: '003', transactionId: 'trx-1', approvalId: 'ok' })) },
    finalize: vi.fn(async () => ({ saleId: 'sale-1', documentState: 'eligible' })),
    ...overrides,
  };
}

describe('physical terminal workflow', () => {
  test('disabled by default and never dispatches', async () => {
    const deps = dependencies({ enabled: false });
    await expect(createPhysicalWorkflow(deps).start({ workstationId: 'w1', requestKey: 'key-1', cart })).rejects.toThrow('physical_disabled');
    expect(deps.provider.send).not.toHaveBeenCalled();
  });
  test('sends the server-calculated amount to the assigned register for display', async () => {
    const deps = dependencies();
    const result = await createPhysicalWorkflow(deps).start({ workstationId: 'w1', requestKey: 'key-1', cart, amountMinor: 1, register: '006' });
    expect(deps.reserve).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 2400, register: '003' }));
    expect(deps.provider.send).toHaveBeenCalledWith({
      amountMinor: 2400, register: '003', merchantTerminal: '2814926', intentId: 'intent-1',
    });
    expect(result.state).toBe('pending');
    expect(deps.finalize).not.toHaveBeenCalled();
  });
  test('same request never dispatches twice', async () => {
    const deps = dependencies();
    deps.claimDispatch.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const workflow = createPhysicalWorkflow(deps);
    await workflow.start({ workstationId: 'w1', requestKey: 'key-1', cart });
    await workflow.start({ workstationId: 'w1', requestKey: 'key-1', cart });
    expect(deps.provider.send).toHaveBeenCalledTimes(1);
  });
  test('busy device is held without dispatch', async () => {
    const deps = dependencies({ claimDispatch: vi.fn(async () => false) });
    const result = await createPhysicalWorkflow(deps).start({ workstationId: 'w1', requestKey: 'key-1', cart });
    expect(result.state).toBe('pending');
    expect(deps.provider.send).not.toHaveBeenCalled();
  });
  test('transport timeout stays uncertain and never retries', async () => {
    const deps = dependencies();
    deps.provider.send.mockRejectedValue(new Error('offline'));
    await createPhysicalWorkflow(deps).start({ workstationId: 'w1', requestKey: 'key-1', cart });
    expect(deps.markUncertain).toHaveBeenCalledWith('intent-1');
    expect(deps.provider.send).toHaveBeenCalledTimes(1);
    expect(deps.finalize).not.toHaveBeenCalled();
  });
  test('only verified matching approval finalizes one sale', async () => {
    const deps = dependencies();
    const workflow = createPhysicalWorkflow(deps);
    await workflow.verify('intent-1');
    expect(deps.provider.inspect).toHaveBeenCalledWith(expect.objectContaining({ id: 'intent-1', register: '003', amountMinor: 2400 }));
    expect(deps.finalize).toHaveBeenCalledWith('intent-1', expect.objectContaining({ transactionId: 'trx-1', amountMinor: 2400 }));
  });
  test('lookup failure leaves the outcome uncertain and creates no sale', async () => {
    const deps = dependencies();
    deps.provider.inspect.mockRejectedValue(new Error('offline'));
    const result = await createPhysicalWorkflow(deps).verify('intent-1');
    expect(result.state).toBe('uncertain');
    expect(deps.finalize).not.toHaveBeenCalled();
  });
  test.each([{ amountMinor: 1 }, { register: '006' }, { merchantTerminal: 'other' }, { intentId: 'other' }, { status: 'declined' }, { transactionId: '' }])('mismatched or unapproved result cannot finalize: %j', async patch => {
    const deps = dependencies();
    deps.provider.inspect.mockResolvedValue({ status: 'approved', intentId: 'intent-1', merchantTerminal: '2814926', amountMinor: 2400, register: '003', transactionId: 'trx-1', approvalId: 'ok', ...patch });
    await createPhysicalWorkflow(deps).verify('intent-1');
    expect(deps.finalize).not.toHaveBeenCalled();
  });
});
