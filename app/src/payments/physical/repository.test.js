import { describe, expect, test, vi } from 'vitest';
import { createPhysicalRepository } from '../../../server/pelecard-physical/repository.js';

const actor = '10000000-0000-4000-8000-000000000001';
const requestKey = '10000000-0000-4000-8000-000000000002';
const paymentId = '10000000-0000-4000-8000-000000000003';

describe('physical database adapter', () => {
  test('reserves a frozen physical payment through its own RPC', async () => {
    const database = { query: vi.fn(async () => ({ rows: [{ result: {
      paymentId, registerNumber: '004', state: 'reserved',
    } }] })) };
    const repository = createPhysicalRepository(database);
    const result = await repository.reserve({ actorId: actor, workstationId: 'FRONT', requestKey,
      register: '004', amountMinor: 2400, items: [{ id: actor, name: 'Ticket', qty: 1, customPrice: 24 }],
      discount: null, site: 'עכו', billing: { kind: 'person', name: 'Customer', identity: '123456782', email: 'a@example.com' } });
    expect(result).toMatchObject({ id: paymentId, register: '004', amountMinor: 2400 });
    const [sql, args] = database.query.mock.calls[0];
    expect(sql).toContain('reserve_physical_payment');
    expect(args[0]).toBe(actor);
    expect(args[2]).toBe('FRONT');
    expect(args[3]).toBe(2400);
    expect(args[4].items).toHaveLength(1);
    expect(args[4].site).toBe('עכו');
    expect(JSON.stringify(args)).not.toMatch(/creditCard|track2|cvv2/i);
  });
  test('rejects an invented site before reserving a standalone terminal payment', async () => {
    const database = { query: vi.fn() };
    await expect(createPhysicalRepository(database).reserve({ actorId: actor, workstationId: 'FRONT', requestKey,
      register: '004', amountMinor: 2400, items: [{ id: actor, name: 'Ticket', qty: 1, customPrice: 24 }],
      discount: null, site: 'חנות', billing: { kind: 'person', name: 'Customer', identity: '123456782', email: 'a@example.com' } }))
      .rejects.toThrow('accounting_site_required');
    expect(database.query).not.toHaveBeenCalled();
  });
  test('persists a correlated approval before calling the idempotent sale finalizer', async () => {
    const database = { query: vi.fn().mockResolvedValueOnce({ rows: [{ result: { state: 'approved' } }] })
      .mockResolvedValueOnce({ rows: [{ result: { state: 'succeeded', saleId: 'sale-1' } }] }) };
    const result = await createPhysicalRepository(database).finalize(paymentId, { status: 'approved',
      intentId: paymentId, merchantTerminal: '2814926015', register: '004', amountMinor: 2400,
      transactionId: 'trx-1', approvalId: 'ok-1' });
    expect(result).toEqual({ saleId: 'sale-1', documentState: 'provider_confirmation_required' });
    expect(database.query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining('observe_physical_result'), expect.stringContaining('finalize_physical_payment'),
    ]);
  });
  test('reserves an order through the dedicated database balance validator', async () => {
    const orderId = '10000000-0000-4000-8000-000000000004';
    const database = { query: vi.fn(async () => ({ rows: [{ result: {
      paymentId, orderId, amountMinor: 1200, registerNumber: '004', state: 'reserved',
    } }] })) };
    const result = await createPhysicalRepository(database).reserveOrder({ actorId: actor,
      actorRole: 'admin', workstationId: 'FRONT', requestKey, register: '004', orderId, amountMinor: 1200 });
    expect(result).toMatchObject({ id: paymentId, orderId, amountMinor: 1200 });
    const [sql, args] = database.query.mock.calls[0];
    expect(sql).toContain('reserve_physical_order_payment');
    expect(args).toEqual([actor, requestKey, 'FRONT', orderId, 1200]);
  });
  test('worker scope looks up the immutable intent payment order before J4', async () => {
    const orderId = '10000000-0000-4000-8000-000000000004';
    const database = { query: vi.fn(async () => ({ rows: [{ order_id: orderId }] })) };
    expect(await createPhysicalRepository(database).orderForIntent(paymentId)).toBe(orderId);
    expect(database.query).toHaveBeenCalledWith(
      'SELECT order_id FROM public.payment_transactions WHERE id=$1::uuid', [paymentId]);
  });
  test('rejects invalid person identity before reserving an invoice-linked payment', async () => {
    const database = { query: vi.fn() };
    await expect(createPhysicalRepository(database).reserve({ actorId: actor, workstationId: 'FRONT', requestKey,
      register: '004', amountMinor: 2400, items: [{ id: actor, name: 'Ticket', qty: 1, customPrice: 24 }],
      discount: null, billing: { kind: 'person', name: 'Customer', identity: '123456789', email: 'a@example.com' } }))
      .rejects.toThrow('physical_billing_invalid');
    expect(database.query).not.toHaveBeenCalled();
  });
});
