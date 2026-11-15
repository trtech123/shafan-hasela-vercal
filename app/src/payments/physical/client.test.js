import { describe, expect, test, vi } from 'vitest';
import { requestPhysicalPayment } from './client.js';

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
