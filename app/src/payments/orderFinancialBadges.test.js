import { describe, expect, it, vi } from 'vitest';
import { loadOrderFinancialBadges, orderFinancialPresentation } from './orderFinancialBadges';

const orderId = '00000000-0000-4000-8000-000000000001';

describe('verified order collection status', () => {
  it.each([
    ['unpaid', 'לא שולם', true],
    ['partial', 'שולם חלקית', true],
    ['paid', 'התשלום בוצע', false],
    ['review', 'תשלום בבדיקה', false],
    ['unavailable', 'גבייה לא זמינה', false],
  ])('maps %s to a safe order action', (state, label, canCollect) => {
    expect(orderFinancialPresentation({ state })).toEqual({ label, canCollect });
  });

  it('keeps collection blocked until a verified summary arrives', () => {
    expect(orderFinancialPresentation(null).canCollect).toBe(false);
    expect(orderFinancialPresentation({ state: 'unknown' }).label).toBe('תשלום בבדיקה');
  });

  it('accepts only complete read-only RPC results for requested orders', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ orderId, state: 'paid',
      totalMinor: 100, paidMinor: 100, balanceMinor: 0 }], error: null });
    expect(await loadOrderFinancialBadges({ rpc }, [orderId])).toMatchObject({
      [orderId]: { state: 'paid', balanceMinor: 0 },
    });
    expect(rpc).toHaveBeenCalledWith('get_order_financial_badges', { p_order_ids: [orderId] });
    rpc.mockResolvedValue({ data: [{ orderId, state: 'paid',
      totalMinor: 100, paidMinor: 100, balanceMinor: 0 }, { orderId, state: 'paid',
      totalMinor: 100, paidMinor: 100, balanceMinor: 0 }], error: null });
    await expect(loadOrderFinancialBadges({ rpc }, [orderId])).rejects.toThrow('invalid');
  });
});
