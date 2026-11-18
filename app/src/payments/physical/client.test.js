import { describe, expect, test, vi } from 'vitest';
import { getOrderPhysicalEvidence, requestPhysicalPayment, startHostedPhysical } from './client.js';

describe('physical POS client', () => {
  test('uses authenticated same-origin physical API and accepts a frozen intent view', async () => {
    const auth = { getSession: vi.fn(async () => ({ data: { session: { access_token: 'token' } } })) };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ paymentId: '11111111-1111-4111-8111-111111111111',
      state: 'reserved', amountMinor: 2400, registerNumber: '004', saleId: null }), { status: 200 }));
    const result = await requestPhysicalPayment({ auth }, { action: 'status', requestKey: 'key' }, fetcher);
    expect(result.registerNumber).toBe('004');
    expect(fetcher.mock.calls[0][0]).toBe('/api/pelecard-physical');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
  });
  test('rejects malformed server state', async () => {
    const auth = { getSession: async () => ({ data: { session: { access_token: 'token' } } }) };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ state: 'succeeded', amountMinor: 2400,
      registerNumber: 4 }), { status: 200 }));
    await expect(requestPhysicalPayment({ auth }, { action: 'status', requestKey: 'key' }, fetcher))
      .rejects.toThrow('physical_status_unavailable');
  });
  test('accepts only the documented Pelecard hosted redirect URL', async () => {
    const auth = { getSession: async () => ({ data: { session: { access_token: 'token' } } }) };
    const base = { paymentId: '11111111-1111-4111-8111-111111111111',
      state: 'pending', route: 'hosted', amountMinor: 2400, registerNumber: '004', saleId: null };
    const good = 'https://gateway21.pelecard.biz/PaymentGW?transactionId=22222222-2222-4222-8222-222222222222';
    expect((await requestPhysicalPayment({ auth }, { action: 'status' }, async () =>
      new Response(JSON.stringify({ ...base, redirectUrl: good })))).redirectUrl).toBe(good);
    const gateway20 = good.replace('gateway21', 'gateway20');
    expect((await requestPhysicalPayment({ auth }, { action: 'status' }, async () =>
      new Response(JSON.stringify({ ...base, redirectUrl: gateway20 })))).redirectUrl).toBe(gateway20);
    await expect(requestPhysicalPayment({ auth }, { action: 'status' }, async () =>
      new Response(JSON.stringify({ ...base, redirectUrl: 'https://evil.example/PaymentGW' })))).rejects
      .toThrow('physical_status_unavailable');
  });
});

test('reads unlinked document evidence without invoking payment actions', async () => {
  const auth = { getSession: async () => ({ data: { session: { access_token: 'token' } } }) };
  const orderId = '11111111-1111-4111-8111-111111111111';
  const calls = [];
  const result = await getOrderPhysicalEvidence({ auth }, orderId, async (_path, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify([{ paymentId: orderId, paymentState: 'uncertain',
      amountMinor: 100, providerTransactionId: '3199515577', documentNumber: '200006',
      documentUrl: 'https://app.payper.co.il/public/invoice_show/3650292?ak=abcdefghijklmnop',
      linked: false }]));
  });
  expect(result).toHaveLength(1);
  expect(calls).toEqual([{ action: 'orderEvidence', orderId }]);
});

test('one cashier Pay action reserves register 004 and opens the hosted PINPAD page', async () => {
  const auth = { getSession: async () => ({ data: { session: { access_token: 'token' } } }) };
  const id = '11111111-1111-4111-8111-111111111111';
  const url = 'https://gateway21.pelecard.biz/PaymentGW?transactionId=22222222-2222-4222-8222-222222222222';
  const actions = [];
  const fetcher = async (_path, options) => {
    const body = JSON.parse(options.body); actions.push(body);
    const data = body.action === 'devices' ? [{ workstationCode: 'CT20', registerNumber: '004', label: 'CT20', model: 'CT20' }]
      : body.action === 'prepareOrder' ? { paymentId: id, state: 'reserved', registerNumber: '004',
        amountMinor: 1500, saleId: null, hostedAvailable: true }
        : { paymentId: id, state: 'pending', route: 'hosted', registerNumber: '004', amountMinor: 1500,
          saleId: null, redirectUrl: url };
    return new Response(JSON.stringify(data), { status: 200 });
  };
  const redirect = vi.fn();
  await startHostedPhysical({ auth }, { requestKey: id, orderId: id, amountMinor: 1500,
    redirect, fetcher });
  expect(actions.map(row => row.action)).toEqual(['devices', 'prepareOrder', 'openHosted']);
  expect(actions[1]).toMatchObject({ amountMinor: 1500, workstationCode: 'CT20' });
  expect(redirect).toHaveBeenCalledWith(url);
});

test('an uncertain physical intent is never opened again', async () => {
  const auth = { getSession: async () => ({ data: { session: { access_token: 'token' } } }) };
  const actions = [];
  const fetcher = async (_path, options) => {
    const body = JSON.parse(options.body); actions.push(body.action);
    return new Response(JSON.stringify(body.action === 'devices'
      ? [{ workstationCode: 'CT20', registerNumber: '004', label: 'CT20', model: 'CT20' }]
      : { paymentId: '11111111-1111-4111-8111-111111111111', state: 'uncertain', registerNumber: '004',
        amountMinor: 1500, saleId: null }), { status: 200 });
  };
  await startHostedPhysical({ auth }, { requestKey: '11111111-1111-4111-8111-111111111111',
    orderId: '11111111-1111-4111-8111-111111111111', amountMinor: 1500, fetcher,
    redirect: vi.fn() });
  expect(actions).toEqual(['devices', 'prepareOrder']);
});
