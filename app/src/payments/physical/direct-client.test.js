import { expect, test, vi } from 'vitest';
import { startDirectPhysical } from './client.js';

test('one cashier action reserves existing order for direct worker without hosted redirect', async () => {
  const orderId = '11111111-1111-4111-8111-111111111111';
  const requestKey = '22222222-2222-4222-8222-222222222222';
  const actions = [];
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic' } } }) } };
  const fetcher = vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body); actions.push(body.action);
    return Response.json(body.action === 'devices'
      ? [{ registerNumber: '004', model: 'CT20', label: 'Synthetic CT20', workstationCode: 'GENERAL' }]
      : { paymentId: '33333333-3333-4333-8333-333333333333', orderId,
        state: 'reserved', registerNumber: '004', amountMinor: 1500, saleId: null,
        redirectUrl: null });
  });
  const saved = await startDirectPhysical(client, { requestKey, orderId,
    amountMinor: 1500, fetcher });
  expect(saved.state).toBe('reserved');
  expect(actions).toEqual(['devices', 'prepareOrder', 'enqueueDirect']);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    orderId, amountMinor: 1500, workstationCode: 'GENERAL' });
});
