import { describe, expect, test, vi } from 'vitest';
import { runPhysicalIntent, recoverPhysicalIntent, runPhysicalWorkerCycle } from '../../../server/pelecard-physical/worker.js';

describe('long-running physical dispatch worker', () => {
  test('requires capacity beyond the documented five-minute provider wait', async () => {
    const workflow = { dispatch: vi.fn(), verify: vi.fn() };
    await expect(runPhysicalIntent({ workflow, intentId: 'intent-1', workerMaxMs: 300_000 }))
      .rejects.toThrow('physical_worker_duration_required');
    expect(workflow.dispatch).not.toHaveBeenCalled();
  });
  test('dispatches once and independently verifies the result', async () => {
    const workflow = { dispatch: vi.fn(async () => ({ state: 'pending' })),
      verify: vi.fn(async () => ({ state: 'succeeded', saleId: 'sale-1' })) };
    expect(await runPhysicalIntent({ workflow, intentId: 'intent-1', workerMaxMs: 330_000 }))
      .toEqual({ state: 'succeeded', saleId: 'sale-1' });
    expect(workflow.dispatch).toHaveBeenCalledTimes(1);
    expect(workflow.verify).toHaveBeenCalledWith('intent-1');
  });
  test('recovery performs status verification without a second financial send', async () => {
    const workflow = { dispatch: vi.fn(), verify: vi.fn(async () => ({ state: 'uncertain' })) };
    expect(await recoverPhysicalIntent({ workflow, intentId: 'intent-1' })).toEqual({ state: 'uncertain' });
    expect(workflow.dispatch).not.toHaveBeenCalled();
  });
});

test('worker cycle dispatches only reserved intents and recovers uncertain ones without resend', async () => {
  const rows = [{ paymentId: 'reserved-1', state: 'reserved' },
    { paymentId: 'uncertain-1', state: 'uncertain' },
    { paymentId: 'approved-1', state: 'approved' }];
  const database = { query: vi.fn(async () => ({ rows: [{ result: rows }] })) };
  const workflow = { dispatch: vi.fn(async () => ({ state: 'pending' })),
    verify: vi.fn(async () => ({ state: 'uncertain' })) };
  await runPhysicalWorkerCycle({ database, workflow, workerMaxMs: 330_000, dispatchEnabled: true });
  expect(workflow.dispatch).toHaveBeenCalledTimes(1);
  expect(workflow.dispatch).toHaveBeenCalledWith('reserved-1');
  expect(workflow.verify).toHaveBeenCalledWith('uncertain-1');
  expect(workflow.verify).toHaveBeenCalledWith('approved-1');
});

test('disabled worker never sends a reserved intent', async () => {
  const database = { query: vi.fn(async () => ({ rows: [{ result: [{ paymentId: 'reserved-1', state: 'reserved' }] }] })) };
  const workflow = { dispatch: vi.fn(), verify: vi.fn() };
  await runPhysicalWorkerCycle({ database, workflow, workerMaxMs: 0, dispatchEnabled: false });
  expect(workflow.dispatch).not.toHaveBeenCalled();
});
