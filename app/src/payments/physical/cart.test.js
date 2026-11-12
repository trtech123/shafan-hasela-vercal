import { describe, expect, test, vi } from 'vitest';
import { createPhysicalCartCalculator } from '../../../server/pelecard-physical/cart.js';

const id = '10000000-0000-4000-8000-000000000001';
const line = { kind: 'product', id, qty: 2 };
function db(price = '12.00') {
  return { query: vi.fn(async () => ({ rows: [{ name: 'Ticket', price, status: 'פעיל' }] })) };
}

describe('server-calculated physical cart', () => {
  test('ignores browser amount and freezes catalog price in agorot', async () => {
    const database = db();
    const result = await createPhysicalCartCalculator(database)({ lines: [line], amountMinor: 1 });
    expect(result).toEqual({ amountMinor: 2400, items: [{ id, name: 'Ticket', qty: 2, customPrice: 12 }] });
    expect(database.query).toHaveBeenCalledTimes(1);
  });
  test('rejects price changes supplied by client', async () => {
    await expect(createPhysicalCartCalculator(db())({ lines: [{ ...line, customPrice: 1 }] }))
      .rejects.toThrow('physical_cart_invalid');
  });
  test('rejects unavailable and invalid catalog amounts', async () => {
    await expect(createPhysicalCartCalculator(db('0.00'))({ lines: [line] })).rejects.toThrow('physical_catalog_unavailable');
    await expect(createPhysicalCartCalculator(db('12.001'))({ lines: [line] })).rejects.toThrow('physical_catalog_unavailable');
  });
  test('rejects duplicate products and zero quantities', async () => {
    await expect(createPhysicalCartCalculator(db())({ lines: [line, line] })).rejects.toThrow('physical_cart_invalid');
    await expect(createPhysicalCartCalculator(db())({ lines: [{ ...line, qty: 0 }] })).rejects.toThrow('physical_cart_invalid');
  });
  test('recalculates an admin fixed discount, rejects cashier discounts', async () => {
    const discount = { type: 'הנחה כללית', mode: 'fixed', value: 4 };
    const result = await createPhysicalCartCalculator(db(), 'admin')({ lines: [line], discount });
    expect(result.amountMinor).toBe(2000);
    expect(result.discount).toMatchObject({ ...discount, original_total: 24, final_total: 20 });
    await expect(createPhysicalCartCalculator(db(), 'cashier')({ lines: [line], discount }))
      .rejects.toThrow('physical_discount_forbidden');
  });
  test('percentage discount rounds to agorot and cannot erase the sale', async () => {
    const result = await createPhysicalCartCalculator(db(), 'admin')({ lines: [line],
      discount: { type: 'הנחת עובד', mode: 'percentage', value: 12.5 } });
    expect(result.amountMinor).toBe(2100);
    await expect(createPhysicalCartCalculator(db(), 'admin')({ lines: [line],
      discount: { type: 'הנחה כללית', mode: 'percentage', value: 100 } }))
      .rejects.toThrow('physical_discount_invalid');
  });
});
