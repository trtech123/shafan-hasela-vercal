import { describe, expect, test } from 'vitest';
import { ACCOUNTING_SITES, requireAccountingSite } from './accountingSite';

describe('cashier accounting site', () => {
  test('accepts an explicit known site and rejects a missing or invented one', () => {
    expect(ACCOUNTING_SITES).toContain('פודטראק');
    expect(requireAccountingSite('עכו')).toBe('עכו');
    expect(() => requireAccountingSite('')).toThrow('accounting_site_required');
    expect(() => requireAccountingSite('חנות')).toThrow('accounting_site_required');
  });
});
